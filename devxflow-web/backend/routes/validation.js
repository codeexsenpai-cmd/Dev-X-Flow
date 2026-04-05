const express = require('express');
const crypto = require('crypto');
const { models } = require('../database');

const router = express.Router();

// Configuration constants
const TRIAL_DURATION_DAYS = 14;

// Feature enforcement: tier features mapping
const TIER_FEATURES = {
    'free': ['basic_git', 'terminal', 'dark_mode'],
    'trial': ['basic_git', 'terminal', 'dark_mode', 'ai_commits', 'database_basic', 'diff_viewer', 'stash_ops', 'debug_monitor'],
    'pro': ['basic_git', 'terminal', 'dark_mode', 'ai_commits', 'database_basic', 'diff_viewer', 'stash_ops', 'debug_monitor'],
    'pro_plus': ['basic_git', 'terminal', 'dark_mode', 'ai_commits', 'database_basic', 'diff_viewer', 'stash_ops', 'debug_monitor', 'merge_resolver', 'interactive_rebase', 'database_advanced'],
    'teams': ['basic_git', 'terminal', 'dark_mode', 'ai_commits', 'database_basic', 'diff_viewer', 'stash_ops', 'debug_monitor', 'merge_resolver', 'interactive_rebase', 'database_advanced', 'team_collaboration', 'admin_dashboard', 'api_access', 'unlimited_devices']
};

// Middleware to check feature access (for protected API routes)
function checkFeatureAccess(requiredFeature) {
    return async (req, res, next) => {
        const rawDeviceId = req.headers['x-device-id'];
        const apiKey = req.headers['x-api-key'];
        
        if (!apiKey || apiKey !== DESKTOP_API_KEY) {
            return res.status(401).json({ error: 'Invalid API key' });
        }
        
        if (!rawDeviceId) {
            return res.status(400).json({ error: 'Device ID required' });
        }
        
        const deviceId = generateDeviceId(req, rawDeviceId);
        
        try {
            // Check for active trial first
            const trial = await models.Trial.findOne({ device_id: deviceId });
            if (trial && trial.expires_at > new Date()) {
                const features = TIER_FEATURES['trial'] || [];
                if (features.includes(requiredFeature)) {
                    req.tier = 'trial';
                    return next();
                }
                return res.status(403).json({ 
                    error: 'Feature not available in trial',
                    feature: requiredFeature,
                    tier: 'trial'
                });
            }
            
            // Check for license activation
            const activation = await models.Activation.findOne({ device_id: deviceId });
            if (!activation) {
                return res.status(403).json({ 
                    error: 'No active license for this device',
                    feature: requiredFeature
                });
            }
            
            const license = await models.License.findById(activation.license_id);
            if (!license || license.status !== 'active') {
                return res.status(403).json({ 
                    error: 'License not active',
                    feature: requiredFeature
                });
            }
            
            const tier = license.tier || 'pro';
            const features = TIER_FEATURES[tier] || [];
            
            if (!features.includes(requiredFeature)) {
                return res.status(403).json({ 
                    error: 'Feature not available in your tier',
                    feature: requiredFeature,
                    tier: tier,
                    required_tier: Object.entries(TIER_FEATURES)
                        .filter(([_, feats]) => feats.includes(requiredFeature))
                        .map(([t]) => t)
                });
            }
            
            req.tier = tier;
            req.license = license;
            next();
        } catch (error) {
            console.error('Feature check error:', error);
            res.status(500).json({ error: 'Failed to check feature access' });
        }
    };
}

// API key for desktop app (simple authentication)
const DESKTOP_API_KEY = process.env.DESKTOP_API_KEY || (process.env.NODE_ENV === 'development' ? 'dev-api-key-please-change-in-production' : null);
if (!DESKTOP_API_KEY) {
    console.error('[SECURITY] DESKTOP_API_KEY not set in environment - validation endpoint disabled');
}

// Middleware to verify desktop app API key
const verifyApiKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    
    if (apiKey !== DESKTOP_API_KEY) {
        return res.status(401).json({
            valid: false,
            error: 'Invalid API key'
        });
    }
    
    next();
};

// Generate device ID from hardware info (authoritative)
function generateDeviceId(req, hardware_info) {
    if (hardware_info) {
        return crypto.createHash('sha256').update(hardware_info).digest('hex').substring(0, 32);
    }
    // Fallback to IP + UA if no hardware info provided (less secure)
    const data = req.ip + req.headers['user-agent'];
    return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
}

// Validate license (called by desktop app)
router.post('/', verifyApiKey, async (req, res) => {
    try {
        const { license_key, device_id, hardware_info } = req.body;
        
        if (!license_key) {
            const final_device_id = device_id || generateDeviceId(req, hardware_info);
            await logValidation('MISSING', final_device_id, req.ip, 'invalid', 'Missing license key');
            
            return res.status(400).json({
                valid: false,
                error: 'License key is required'
            });
        }

        // Get license from database
        const license = await models.License.findOne({ license_key });

        if (!license) {
            const final_device_id = device_id || generateDeviceId(req, hardware_info);
            await logValidation(license_key, final_device_id, req.ip, 'invalid', 'License not found');
            
            return res.status(404).json({
                valid: false,
                error: 'Invalid license key'
            });
        }

        // Check if license is revoked
        if (license.status === 'revoked') {
            const final_device_id = device_id || generateDeviceId(req, hardware_info);
            await logValidation(license_key, final_device_id, req.ip, 'invalid', 'License revoked');
            
            return res.status(403).json({
                valid: false,
                error: 'License has been revoked'
            });
        }

        // Check if license has expired
        if (license.expires_at && new Date(license.expires_at) < new Date()) {
            const final_device_id = device_id || generateDeviceId(req, hardware_info);
            await logValidation(license_key, final_device_id, req.ip, 'expired', 'License expired');
            
            return res.status(403).json({
                valid: false,
                error: 'License has expired',
                expires_at: license.expires_at
            });
        }

        // Use hardware_info to generate a stable HWID if provided
        const deviceIdToUse = device_id || generateDeviceId(req, hardware_info);
        
        // Check device activation limit
        const activationCount = await models.Activation.countDocuments({ license_id: license._id });

        // Check if this device is already activated
        const existingActivation = await models.Activation.findOne({ 
            license_id: license._id, 
            device_id: deviceIdToUse 
        });

        if (!existingActivation && activationCount >= license.max_activations) {
            await logValidation(license_key, deviceIdToUse, req.ip, 'limit_exceeded', 'Max activations reached');
            
            return res.status(403).json({
                valid: false,
                error: 'Maximum number of activations reached',
                max_activations: license.max_activations,
                current_activations: activationCount
            });
        }

        // Activate or update this device
        if (existingActivation) {
            existingActivation.last_seen = new Date();
            await existingActivation.save();
        } else {
            const activation = new models.Activation({
                license_id: license._id,
                device_id: deviceIdToUse
            });
            await activation.save();
        }

        await logValidation(license_key, deviceIdToUse, req.ip, 'valid', 'License validated successfully');

        // Determine tier based on license type
        const tier = license.tier || 'pro'; // Default to pro if not specified
        
        // Define features available for each tier
        const tierFeatures = {
            'free': ['basic_git', 'terminal', 'dark_mode'],
            'pro': ['basic_git', 'terminal', 'dark_mode', 'ai_commits', 'database_basic', 'diff_viewer', 'stash_ops', 'debug_monitor'],
            'pro_plus': ['basic_git', 'terminal', 'dark_mode', 'ai_commits', 'database_basic', 'diff_viewer', 'stash_ops', 'debug_monitor', 'merge_resolver', 'interactive_rebase', 'database_advanced'],
            'teams': ['basic_git', 'terminal', 'dark_mode', 'ai_commits', 'database_basic', 'diff_viewer', 'stash_ops', 'debug_monitor', 'merge_resolver', 'interactive_rebase', 'database_advanced', 'team_collaboration', 'admin_dashboard', 'api_access', 'unlimited_devices']
        };

        res.json({
            valid: true,
            license: {
                key: license.license_key,
                status: license.status,
                customer_email: license.customer_email,
                expires_at: license.expires_at,
                max_activations: license.max_activations,
                current_activations: existingActivation ? activationCount : activationCount + 1,
                device_id: deviceIdToUse,
                tier: tier,
                features: tierFeatures[tier] || tierFeatures['pro']
            }
        });

    } catch (error) {
        console.error('License validation error:', error);
        res.status(500).json({
            valid: false,
            error: 'Validation failed'
        });
    }
});

// Heartbeat endpoint (client pings this periodically)
router.post('/heartbeat', verifyApiKey, async (req, res) => {
    try {
        const { license_key, device_id, hardware_info } = req.body;
        
        if (!license_key || (!device_id && !hardware_info)) {
            return res.status(400).json({ valid: false, error: 'Missing required parameters' });
        }

        const license = await models.License.findOne({ license_key, status: 'active' });
        if (!license) return res.status(404).json({ valid: false, error: 'License invalid or revoked' });

        const deviceIdToUse = device_id || generateDeviceId(req, hardware_info);
        const activation = await models.Activation.findOne({ license_id: license._id, device_id: deviceIdToUse });

        if (!activation) {
            return res.status(403).json({ valid: false, error: 'Device not activated' });
        }

        activation.last_seen = new Date();
        await activation.save();

        res.json({ valid: true, timestamp: new Date() });

    } catch (error) {
        console.error('Heartbeat error:', error);
        res.status(500).json({ valid: false, error: 'Heartbeat failed' });
    }
});

// Helper function to log validation attempts
async function logValidation(licenseKey, deviceId, ipAddress, result, message) {
    try {
        const log = new models.ValidationLog({
            license_key: licenseKey,
            device_id: deviceId || null,
            ip_address: ipAddress || null,
            result,
            message
        });
        await log.save();
    } catch (err) {
        console.error('Failed to log validation:', err);
    }
}

// Deactivate a device (called when user wants to free up a slot)
router.post('/deactivate', verifyApiKey, async (req, res) => {
    try {
        const { license_key, device_id } = req.body;

        if (!license_key || !device_id) {
            return res.status(400).json({
                success: false,
                error: 'License key and device ID are required'
            });
        }

        // Get license
        const license = await models.License.findOne({ license_key });

        if (!license) {
            return res.status(404).json({
                success: false,
                error: 'License not found'
            });
        }

        // Delete activation
        await models.Activation.deleteOne({ 
            license_id: license._id, 
            device_id: device_id 
        });

        res.json({
            success: true,
            message: 'Device deactivated successfully'
        });

    } catch (error) {
        console.error('Deactivation error:', error);
        res.status(500).json({
            success: false,
            error: 'Deactivation failed'
        });
    }
});

// Auth status endpoint (called by desktop app)
router.get('/auth/status', verifyApiKey, async (req, res) => {
    try {
        const rawDeviceId = req.headers['x-device-id'];
        
        if (!rawDeviceId) {
            return res.json({ authenticated: false });
        }

        // Hash device ID consistently (same as validation endpoint)
        const deviceId = generateDeviceId(req, rawDeviceId);

        // Check for trial by device ID
        const trial = await models.Trial.findOne({ device_id: deviceId });
        
        // Check for license activation by device ID
        const activation = await models.Activation.findOne({ device_id: deviceId });
        
        if (activation) {
            const license = await models.License.findById(activation.license_id);
            if (license && license.status === 'active') {
                return res.json({
                    authenticated: true,
                    user: {
                        id: deviceId,
                        email: license.customer_email,
                        name: license.customer_email.split('@')[0]
                    },
                    trial: trial && trial.expires_at > new Date() ? {
                        active: true,
                        expires_at: trial.expires_at,
                        days_remaining: Math.ceil((new Date(trial.expires_at) - new Date()) / (1000 * 60 * 60 * 24))
                    } : undefined,
                    license: {
                        key: license.license_key,
                        tier: license.tier
                    }
                });
            }
        }

        // Return trial status if no license
        if (trial && trial.expires_at > new Date()) {
            return res.json({
                authenticated: false,
                trial: {
                    active: true,
                    expires_at: trial.expires_at,
                    days_remaining: Math.ceil((new Date(trial.expires_at) - new Date()) / (1000 * 60 * 60 * 24))
                }
            });
        }

        res.json({ authenticated: false });
    } catch (error) {
        console.error('Auth status error:', error);
        res.json({ authenticated: false });
    }
});

// Start trial endpoint (called by desktop app)
router.post('/trial/start', verifyApiKey, async (req, res) => {
    try {
        const rawDeviceId = req.headers['x-device-id'];
        
        if (!rawDeviceId) {
            return res.status(400).json({ success: false, error: 'Device ID required' });
        }

        // Hash device ID consistently
        const deviceId = generateDeviceId(req, rawDeviceId);

        // Check if trial already exists for this device
        const existingTrial = await models.Trial.findOne({ device_id: deviceId });
        if (existingTrial) {
            return res.json({ 
                success: false, 
                error: 'Trial already started',
                trial: {
                    active: existingTrial.expires_at > new Date(),
                    expires_at: existingTrial.expires_at,
                    days_remaining: Math.max(0, Math.ceil((new Date(existingTrial.expires_at) - new Date()) / (1000 * 60 * 60 * 24)))
                }
            });
        }

        // Create new trial
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + TRIAL_DURATION_DAYS);

        const trial = new models.Trial({
            device_id: deviceId,
            started_at: new Date(),
            expires_at: expiresAt
        });
        await trial.save();

        res.json({
            success: true,
            trial: {
                active: true,
                expires_at: expiresAt,
                days_remaining: TRIAL_DURATION_DAYS
            }
        });
    } catch (error) {
        console.error('Trial start error:', error);
        res.status(500).json({ success: false, error: 'Failed to start trial' });
    }
});

// Check trial status endpoint
router.get('/trial/status', verifyApiKey, async (req, res) => {
    try {
        const rawDeviceId = req.headers['x-device-id'];
        
        if (!rawDeviceId) {
            return res.json({ active: false, days_remaining: 0 });
        }

        // Hash device ID consistently
        const deviceId = generateDeviceId(req, rawDeviceId);

        const trial = await models.Trial.findOne({ device_id: deviceId });
        
        if (!trial) {
            return res.json({ active: false, days_remaining: 0 });
        }

        const active = trial.expires_at > new Date();
        const daysRemaining = active ? Math.ceil((new Date(trial.expires_at) - new Date()) / (1000 * 60 * 60 * 24)) : 0;

        res.json({
            active,
            days_remaining: Math.max(0, daysRemaining),
            expires_at: trial.expires_at
        });
    } catch (error) {
        console.error('Trial status error:', error);
        res.json({ active: false, days_remaining: 0 });
    }
});

// Auth callback endpoint (for deep link authentication)
router.post('/auth/callback', verifyApiKey, async (req, res) => {
    try {
        const { token } = req.body;
        const rawDeviceId = req.headers['x-device-id'];
        
        if (!token) {
            return res.json({ authenticated: false });
        }

        // Hash device ID consistently if provided
        const deviceId = rawDeviceId ? generateDeviceId(req, rawDeviceId) : null;

        // Verify JWT token
        const jwt = require('jsonwebtoken');
        const JWT_SECRET = process.env.JWT_SECRET || 'devxflow-secret-key-change-in-production';
        
        let decoded;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch (e) {
            return res.json({ authenticated: false });
        }

        // Find customer from token
        const customer = await models.Customer.findById(decoded.customerId || decoded.id);
        if (!customer) {
            return res.json({ authenticated: false });
        }

        // Find license for this customer
        const license = await models.License.findOne({ 
            customer_email: customer.email, 
            status: 'active' 
        });

        // Activate device if license exists
        if (license && deviceId) {
            const existingActivation = await models.Activation.findOne({
                license_id: license._id,
                device_id: deviceId
            });

            if (!existingActivation) {
                const activationCount = await models.Activation.countDocuments({ license_id: license._id });
                if (activationCount < license.max_activations) {
                    const activation = new models.Activation({
                        license_id: license._id,
                        device_id: deviceId
                    });
                    await activation.save();
                }
            }
        }

        res.json({
        authenticated: true,
        user: {
            id: customer._id,
            email: customer.email,
            name: customer.name || customer.email.split('@')[0]
        },
        license: license ? {
            key: license.license_key,
            tier: license.tier
        } : undefined
    });
    } catch (error) {
        console.error('Auth callback error:', error);
        res.json({ authenticated: false });
    }
});

// Feature check endpoint for desktop app
router.get('/feature/:featureName', verifyApiKey, async (req, res) => {
    try {
        const { featureName } = req.params;
        const rawDeviceId = req.headers['x-device-id'];
        
        if (!rawDeviceId) {
            return res.json({ available: false, reason: 'No device ID' });
        }
        
        const deviceId = generateDeviceId(req, rawDeviceId);
        
        // Check for active trial
        const trial = await models.Trial.findOne({ device_id: deviceId });
        if (trial && trial.expires_at > new Date()) {
            const features = TIER_FEATURES['trial'] || [];
            return res.json({
                available: features.includes(featureName),
                tier: 'trial',
                feature: featureName
            });
        }
        
        // Check for license activation
        const activation = await models.Activation.findOne({ device_id: deviceId });
        if (!activation) {
            return res.json({ available: false, reason: 'No active license' });
        }
        
        const license = await models.License.findById(activation.license_id);
        if (!license || license.status !== 'active') {
            return res.json({ available: false, reason: 'License not active' });
        }
        
        const tier = license.tier || 'pro';
        const features = TIER_FEATURES[tier] || [];
        
        res.json({
            available: features.includes(featureName),
            tier: tier,
            feature: featureName
        });
    } catch (error) {
        console.error('Feature check error:', error);
        res.status(500).json({ available: false, error: 'Failed to check feature' });
    }
});

// Export checkFeatureAccess for use in other routes
module.exports = { router, checkFeatureAccess, TIER_FEATURES };
