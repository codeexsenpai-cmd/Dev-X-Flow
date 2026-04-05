"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.LicenseService = exports.FEATURE_FLAGS = void 0;
const node_machine_id_1 = require("node-machine-id");
const electron_1 = require("electron");
const path = __importStar(require("node:path"));
const fs = __importStar(require("node:fs"));
// Configuration - use environment variables in production
const API_BASE = process.env.DEVXFLOW_API_URL || 'https://devxflow.com/api/validation';
const WEB_BASE = process.env.DEVXFLOW_WEB_URL || 'https://devxflow.com';
const API_KEY = process.env.DEVXFLOW_API_KEY || 'devxflow-desktop-key';
exports.FEATURE_FLAGS = {
    // Free tier features
    'basic_git': ['free', 'pro', 'pro_plus', 'teams'],
    'terminal': ['free', 'pro', 'pro_plus', 'teams'],
    'dark_mode': ['free', 'pro', 'pro_plus', 'teams'],
    // Pro tier features
    'ai_commits': ['pro', 'pro_plus', 'teams'],
    'database_basic': ['pro', 'pro_plus', 'teams'],
    'diff_viewer': ['pro', 'pro_plus', 'teams'],
    'stash_ops': ['pro', 'pro_plus', 'teams'],
    'debug_monitor': ['pro', 'pro_plus', 'teams'],
    // Pro+ tier features
    'merge_resolver': ['pro_plus', 'teams'],
    'interactive_rebase': ['pro_plus', 'teams'],
    'database_advanced': ['pro_plus', 'teams'],
    // Teams tier features
    'team_collaboration': ['teams'],
    'admin_dashboard': ['teams'],
    'api_access': ['teams'],
    'unlimited_devices': ['teams']
};
class LicenseService {
    static instance;
    currentLicense = null;
    deviceId = null;
    hashedDeviceId = null;
    heartbeatTimer = null;
    cachedStatus = null;
    lastValidationTime = 0;
    GRACE_PERIOD_MS = 24 * 60 * 60 * 1000; // 24 hours
    constructor() {
        this.deviceId = (0, node_machine_id_1.machineIdSync)();
        // Generate hashed device ID (same way backend does)
        // Note: We send raw hardware_info to backend, which hashes it
        // For x-device-id header, we use the raw machine ID
        this.loadCachedStatus();
    }
    /**
     * Get raw machine ID (used as hardware_info for validation)
     */
    getRawDeviceId() {
        return this.deviceId || '';
    }
    /**
     * Get device ID for x-device-id header (raw machine ID)
     * Backend auth/trial endpoints use this directly
     */
    getDeviceId() {
        return this.deviceId || '';
    }
    static getInstance() {
        if (!LicenseService.instance) {
            LicenseService.instance = new LicenseService();
        }
        return LicenseService.instance;
    }
    getLicensePath() {
        return path.join(electron_1.app.getPath('userData'), '.license');
    }
    getCachePath() {
        return path.join(electron_1.app.getPath('userData'), '.license_cache');
    }
    loadCachedStatus() {
        try {
            const cachePath = this.getCachePath();
            if (fs.existsSync(cachePath)) {
                const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
                this.cachedStatus = data.status;
                this.lastValidationTime = data.timestamp || 0;
            }
        }
        catch (e) {
            console.warn('Failed to load cached license status:', e);
        }
    }
    saveCachedStatus(status) {
        try {
            const cachePath = this.getCachePath();
            fs.writeFileSync(cachePath, JSON.stringify({
                status,
                timestamp: Date.now()
            }));
            this.cachedStatus = status;
            this.lastValidationTime = Date.now();
        }
        catch (e) {
            console.warn('Failed to save cached license status:', e);
        }
    }
    isWithinGracePeriod() {
        if (!this.cachedStatus || this.lastValidationTime === 0) {
            return false;
        }
        return (Date.now() - this.lastValidationTime) < this.GRACE_PERIOD_MS;
    }
    getCachedStatus() {
        return this.cachedStatus;
    }
    async checkStoredLicense() {
        try {
            const p = this.getLicensePath();
            if (fs.existsSync(p)) {
                const key = fs.readFileSync(p, 'utf8').trim();
                return await this.activate(key);
            }
        }
        catch (e) {
            console.error('License check error:', e);
            // Try cached status on error (offline mode)
            if (this.isWithinGracePeriod() && this.cachedStatus) {
                console.log('Using cached license status (offline mode)');
                return this.cachedStatus;
            }
        }
        return { valid: false, error: 'No license found' };
    }
    async activate(licenseKey) {
        try {
            const response = await fetch(`${API_BASE}/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': API_KEY
                },
                body: JSON.stringify({
                    license_key: licenseKey,
                    hardware_info: this.deviceId
                })
            });
            const data = await response.json();
            if (data.valid) {
                this.currentLicense = licenseKey;
                fs.writeFileSync(this.getLicensePath(), licenseKey);
                this.saveCachedStatus(data); // Cache for offline use
                this.startHeartbeat();
            }
            return data;
        }
        catch (e) {
            // On connection failure, check cache with grace period
            if (this.isWithinGracePeriod() && this.cachedStatus && this.currentLicense === licenseKey) {
                console.log('Using cached license (server unavailable)');
                return this.cachedStatus;
            }
            return { valid: false, error: 'Connection failed' };
        }
    }
    startHeartbeat() {
        if (this.heartbeatTimer)
            clearInterval(this.heartbeatTimer);
        let heartbeatFailures = 0;
        const MAX_FAILURES = 3;
        const GRACE_PERIOD_MS = 60 * 60 * 1000; // 1 hour
        let gracePeriodStart = null;
        this.heartbeatTimer = setInterval(async () => {
            if (!this.currentLicense)
                return;
            try {
                const response = await fetch(`${API_BASE}/heartbeat`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': API_KEY
                    },
                    body: JSON.stringify({
                        license_key: this.currentLicense,
                        hardware_info: this.deviceId
                    })
                });
                const data = await response.json();
                if (!data.valid) {
                    console.error('Heartbeat failed, license invalid');
                    electron_1.app.quit(); // Force close if license invalidated
                    return;
                }
                // Reset failure count on success
                heartbeatFailures = 0;
                gracePeriodStart = null;
            }
            catch (e) {
                heartbeatFailures++;
                console.warn(`Heartbeat connection failed (attempt ${heartbeatFailures}/${MAX_FAILURES})`);
                // Start grace period on first failure
                if (!gracePeriodStart) {
                    gracePeriodStart = Date.now();
                }
                // Check if we're within grace period
                const graceElapsed = Date.now() - gracePeriodStart;
                if (graceElapsed < GRACE_PERIOD_MS) {
                    console.log(`Within grace period (${Math.round((GRACE_PERIOD_MS - graceElapsed) / 60000)} minutes remaining)`);
                    return;
                }
                // Exceeded grace period - check cache
                if (this.isWithinGracePeriod() && this.cachedStatus) {
                    console.log('Using cached license (heartbeat failed, grace period exceeded)');
                    return;
                }
                // No cache available - force re-validation
                console.error('Heartbeat failed, no cached license available');
                electron_1.app.quit();
            }
        }, 1000 * 60 * 15); // Every 15 minutes
    }
    // Feature flag checking methods
    async getCurrentTier() {
        const status = await this.checkStoredLicense();
        if (!status.valid || !status.license) {
            return 'free'; // Default to free tier if no valid license
        }
        return status.license.tier || 'free';
    }
    isFeatureAvailable(featureName, tier) {
        const allowedTiers = exports.FEATURE_FLAGS[featureName];
        if (!allowedTiers) {
            console.warn(`Feature ${featureName} not found in feature flags`);
            return false;
        }
        return allowedTiers.includes(tier);
    }
    async checkFeature(featureName) {
        const tier = await this.getCurrentTier();
        return this.isFeatureAvailable(featureName, tier);
    }
    getAvailableFeatures(tier) {
        return Object.entries(exports.FEATURE_FLAGS)
            .filter(([_, tiers]) => tiers.includes(tier))
            .map(([feature]) => feature);
    }
    async getAllAvailableFeatures() {
        const tier = await this.getCurrentTier();
        return this.getAvailableFeatures(tier);
    }
    // Authentication & Trial Methods
    async getAuthStatus() {
        try {
            const response = await fetch(`${API_BASE}/auth/status`, {
                method: 'GET',
                headers: {
                    'x-api-key': API_KEY,
                    'x-device-id': this.deviceId || ''
                }
            });
            return await response.json();
        }
        catch (e) {
            return { authenticated: false };
        }
    }
    openLoginInBrowser() {
        // Open web login with callback to electron app via deep link
        const callbackUrl = `devxflow://auth/callback`;
        const loginUrl = `${WEB_BASE}/login?redirect=${encodeURIComponent(callbackUrl)}&client=electron`;
        electron_1.shell.openExternal(loginUrl);
    }
    async startTrial() {
        try {
            const response = await fetch(`${API_BASE}/trial/start`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': API_KEY,
                    'x-device-id': this.deviceId || ''
                }
            });
            const data = await response.json();
            if (data.success) {
                return { success: true, trial: data.trial };
            }
            return { success: false, error: data.error || 'Failed to start trial' };
        }
        catch (e) {
            return { success: false, error: 'Connection failed' };
        }
    }
    async checkTrialStatus() {
        try {
            const response = await fetch(`${API_BASE}/trial/status`, {
                method: 'GET',
                headers: {
                    'x-api-key': API_KEY,
                    'x-device-id': this.deviceId || ''
                }
            });
            const data = await response.json();
            return data;
        }
        catch (e) {
            return { active: false, days_remaining: 0 };
        }
    }
    async handleAuthCallback(token) {
        try {
            const response = await fetch(`${API_BASE}/auth/callback`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': API_KEY,
                    'x-device-id': this.deviceId || ''
                },
                body: JSON.stringify({ token })
            });
            const data = await response.json();
            // If user has license, activate it
            if (data.license?.key) {
                await this.activate(data.license.key);
            }
            return data;
        }
        catch (e) {
            return { authenticated: false };
        }
    }
}
exports.LicenseService = LicenseService;
