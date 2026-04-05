/**
 * External ping script to keep the Render.com service alive
 * Run this as a scheduled task/cron job or from another server
 * 
 * Usage: node external-ping.js [url]
 * 
 * For Render.com free tier, services sleep after 15 minutes of inactivity.
 * This script pings at randomized intervals (8-13 minutes) to prevent sleep.
 */

const https = require('https');

// The URL of your Render.com service - can be overridden via command line
const serviceUrl = process.argv[2] || 'https://dev-x-flow.onrender.com/api/health';

// Random interval between 8-13 minutes (in milliseconds)
function getRandomInterval() {
  const minMinutes = 8;
  const maxMinutes = 13;
  const randomMinutes = Math.floor(Math.random() * (maxMinutes - minMinutes + 1)) + minMinutes;
  return randomMinutes * 60 * 1000;
}

// Ping function
function ping() {
  const timestamp = new Date().toISOString();
  console.log(`\n[${timestamp}] Pinging ${serviceUrl}...`);
  
  const req = https.get(serviceUrl, (res) => {
    let data = '';
    
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      console.log(`Status code: ${res.statusCode}`);
      try {
        const parsedData = JSON.parse(data);
        console.log('Response:', JSON.stringify(parsedData, null, 2));
      } catch (e) {
        console.log('Response:', data);
      }
      
      // Schedule next ping
      scheduleNextPing();
    });
  });
  
  req.on('error', (error) => {
    console.error(`Error: ${error.message}`);
    // Still schedule next ping even on error
    scheduleNextPing();
  });
  
  req.end();
}

// Schedule next ping with random interval
function scheduleNextPing() {
  const interval = getRandomInterval();
  const minutes = Math.round(interval / 60000);
  console.log(`Next ping in ${minutes} minutes...`);
  setTimeout(ping, interval);
}

// Start the ping loop
console.log('=== Dev-X-Flow Backend Keep-Alive Script ===');
console.log('Pinging at random intervals (8-13 minutes) to prevent Render sleep');
console.log('Press Ctrl+C to stop\n');

// Initial ping
ping();
