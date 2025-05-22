// Library imports
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const https = require('https');

// SerialPort für Termux-kompatibles Build
const SerialPort = require('@serialport/stream');
const CBinding  = require('@serialport/bindings-cpp');
SerialPort.Binding = CBinding;

const { parseAudioDevice } = require('./stream/parser');
const { configName, serverConfig, configUpdate, configSave, configExists, configPath } = require('./server_config');
const helpers = require('./helpers');
const storage = require('./storage');
const { logInfo, logDebug, logWarn, logError, logFfmpeg, logs } = require('./console');
const dataHandler = require('./datahandler');
const fmdxList = require('./fmdx_list');
const { allPluginConfigs } = require('./plugins');

// Endpoints
router.get('/', (req, res) => {
    let requestIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const normalizedIp = requestIp?.replace(/^::ffff:/, '');
    const ipList = normalizedIp.split(',').map(ip => ip.trim());
    const isBanned = ipList.some(ip => serverConfig.webserver.banlist.some(banEntry => banEntry[0] === ip));
    
    if (isBanned) {
        res.render('403');
        logInfo(`Web client (${normalizedIp}) is banned`);
        return;
    }

    const noPlugins = req.query.noPlugins === 'true';

    if (!configExists()) {
        SerialPort.list().then(deviceList => {
            const serialPorts = deviceList.map(port => ({
                path: port.path,
                friendlyName: port.friendlyName,
            }));
            parseAudioDevice(result => {
                res.render('wizard', {
                    isAdminAuthenticated: true,
                    videoDevices: result.audioDevices,
                    audioDevices: result.videoDevices,
                    serialPorts
                });
            });
        });
    } else {
        res.render('index', {
            isAdminAuthenticated: req.session.isAdminAuthenticated,
            isTuneAuthenticated: req.session.isTuneAuthenticated,
            tunerName: serverConfig.identification.tunerName,
            tunerDesc: helpers.parseMarkdown(serverConfig.identification.tunerDesc),
            tunerDescMeta: helpers.removeMarkdown(serverConfig.identification.tunerDesc),
            tunerLock: serverConfig.lockToAdmin,
            publicTuner: serverConfig.publicTuner,
            ownerContact: serverConfig.identification.contact,
            antennas: serverConfig.antennas,
            tuningLimit: serverConfig.webserver.tuningLimit,
            tuningLowerLimit: serverConfig.webserver.tuningLowerLimit,
            tuningUpperLimit: serverConfig.webserver.tuningUpperLimit,
            chatEnabled: serverConfig.webserver.chatEnabled,
            device: serverConfig.device,
            noPlugins,
            plugins: serverConfig.plugins,
            fmlist_integration: serverConfig.extras.fmlistIntegration,
            fmlist_adminOnly: serverConfig.extras.fmlistAdminOnly,
            bwSwitch: serverConfig.bwSwitch
        });
    }
});

router.get('/403', (req, res) => {
    res.render('403');
});

router.get('/wizard', (req, res) => {
    if (!req.session.isAdminAuthenticated) {
        res.render('login');
        return;
    }
    SerialPort.list().then(deviceList => {
        const serialPorts = deviceList.map(port => ({
            path: port.path,
            friendlyName: port.friendlyName,
        }));
        parseAudioDevice(result => {
            res.render('wizard', {
                isAdminAuthenticated: true,
                videoDevices: result.audioDevices,
                audioDevices: result.videoDevices,
                serialPorts
            });
        });
    });
});

router.get('/setup', (req, res) => {
    if (!req.session.isAdminAuthenticated) {
        res.render('login');
        return;
    }
    function loadConfig() {
        if (fs.existsSync(configPath)) {
            return JSON.parse(fs.readFileSync(configPath, 'utf8'));
        }
        return serverConfig;
    }
    SerialPort.list().then(deviceList => {
        const serialPorts = deviceList.map(port => ({
            path: port.path,
            friendlyName: port.friendlyName,
        }));
        parseAudioDevice(result => {
            const uptimeSec = Math.floor(process.uptime());
            res.render('setup', {
                isAdminAuthenticated: true,
                videoDevices: result.audioDevices,
                audioDevices: result.videoDevices,
                serialPorts,
                memoryUsage: (process.memoryUsage().rss / 1024 / 1024).toFixed(1) + ' MB',
                processUptime: helpers.formatUptime(uptimeSec),
                consoleOutput: logs,
                plugins: allPluginConfigs,
                enabledPlugins: loadConfig().plugins,
                onlineUsers: dataHandler.dataToSend.users,
                connectedUsers: storage.connectedUsers,
                banlist: loadConfig().webserver.banlist
            });
        });
    });
});

router.get(['/rds','/rdsspy'], (req, res) => {
    res.send('Please connect using a WebSocket compatible app to obtain RDS stream.');
});

router.get('/api', (req, res) => {
    const { ps_errors, rt0_errors, rt1_errors, ims, eq, ant, st_forced, previousFreq, txInfo, ...data } = dataHandler.dataToSend;
    res.json({
        ...data,
        txInfo,
        ps_errors,
        ant
    });
});

const loginAttempts = {};
const MAX_ATTEMPTS = 25;
const WINDOW_MS = 15 * 60 * 1000;

const authenticate = (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    if (!loginAttempts[ip] || now - loginAttempts[ip].lastAttempt > WINDOW_MS) {
        loginAttempts[ip] = { count: 0, lastAttempt: now };
    }
    if (loginAttempts[ip].count >= MAX_ATTEMPTS) {
        return res.status(403).json({ message: 'Too many login attempts. Please try again later.' });
    }
    const { password } = req.body;
    loginAttempts[ip].lastAttempt = now;
    if (password === serverConfig.password.adminPass) {
        req.session.isAdminAuthenticated = true;
        req.session.isTuneAuthenticated = true;
        logInfo(`User from ${ip} logged in as an administrator.`);
        loginAttempts[ip].count = 0;
        return next();
    }
    if (password === serverConfig.password.tunePass) {
        req.session.isAdminAuthenticated = false;
        req.session.isTuneAuthenticated = true;
        logInfo(`User from ${ip} logged in with tune permissions.`);
        loginAttempts[ip].count = 0;
        return next();
    }
    loginAttempts[ip].count++;
    res.status(403).json({ message: 'Login failed. Wrong password?' });
};

router.post('/login', authenticate, (req, res) => {
    res.status(200).json({ message: 'Logged in successfully, refreshing the page...' });
});

router.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.status(200).json({ message: 'Logged out successfully, refreshing the page...' });
    });
});

router.get('/kick', (req, res) => {
    if (req.session.isAdminAuthenticated) {
        helpers.kickClient(req.query.ip);
    }
    setTimeout(() => res.redirect('/setup'), 500);
});

router.get('/addToBanlist', (req, res) => {
    const userBanData = [ req.query.ip, 'Unknown', Date.now(), req.query.reason ];
    if (req.session.isAdminAuthenticated) {
        serverConfig.webserver.banlist.push(userBanData);
        configSave();
        helpers.kickClient(req.query.ip);
        return res.json({ success: true, message: 'IP address added to banlist.' });
    }
    res.status(403).json({ success: false, message: 'Unauthorized access.' });
});

router.get('/removeFromBanlist', (req, res) => {
    const idx = serverConfig.webserver.banlist.findIndex(ban => ban[0] === req.query.ip);
    if (idx !== -1) {
        serverConfig.webserver.banlist.splice(idx, 1);
        configSave();
        return res.json({ success: true, message: 'IP address removed from banlist.' });
    }
    res.status(404).json({ success: false, message: 'IP address not found in banlist.' });
});

router.post('/saveData', (req, res) => {
    if (req.session.isAdminAuthenticated || !configExists()) {
        configUpdate(req.body);
        fmdxList.update();
        const firstSetup = !configExists();
        logInfo('Server config changed successfully.');
        return res.status(200).send(
            firstSetup
            ? 'Data saved successfully!\nPlease, restart the server to load your configuration.'
            : 'Data saved successfully!\nSome settings may need a server restart to apply.'
        );
    }
});

router.get('/getData', (req, res) => {
    if (!configExists()) return res.json(serverConfig);
    if (req.session.isAdminAuthenticated) {
        return res.sendFile(path.join(__dirname, '..', `${configName}.json`));
    }
    res.status(403).end();
});

router.get('/getDevices', (req, res) => {
    if (req.session.isAdminAuthenticated || !fs.existsSync(`${configName}.json`)) {
        return parseAudioDevice(result => res.json(result));
    }
    res.status(403).json({ error: 'Unauthorized' });
});

router.get('/static_data', (req, res) => {
    res.json({
        qthLatitude: serverConfig.identification.lat,
        qthLongitude: serverConfig.identification.lon,
        presets: serverConfig.webserver.presets || [],
        defaultTheme: serverConfig.webserver.defaultTheme || 'theme1',
        bgImage: serverConfig.webserver.bgImage || '',
        rdsMode: serverConfig.webserver.rdsMode || false,
        tunerName: serverConfig.identification.tunerName || '',
        tunerDesc: serverConfig.identification.tunerDesc || '',
        ant: serverConfig.antennas || {}
    });
});

router.get('/server_time', (req, res) => {
    const serverTimeUTC = new Date(Date.now() - (new Date().getTimezoneOffset() * 60000));
    res.json({ serverTime: serverTimeUTC });
});

router.get('/ping', (req, res) => {
    res.send('pong');
});

const logHistory = {};
function canLog(id) {
    const now = Date.now();
    if (logHistory[id] && now - logHistory[id] < 60 * 60 * 1000) {
        return false;
    }
    logHistory[id] = now;
    return true;
}

router.get('/log_fmlist', (req, res) => {
    if (!dataHandler.dataToSend.txInfo.tx) {
        return res.status(500).send('No suitable transmitter to log.');
    }
    if (!serverConfig.extras.fmlistIntegration || (serverConfig.extras.fmlistAdminOnly && !req.session.isTuneAuthenticated)) {
        return res.status(500).send('FMLIST Integration is not available.');
    }
    const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const txId = dataHandler.dataToSend.txInfo.id;
    if (!canLog(txId)) {
        return res.status(429).send(`ID ${txId} was already logged recently. Please wait before logging again.`);
    }

    const postData = JSON.stringify({
        station: {
            freq: dataHandler.dataToSend.freq,
            pi: dataHandler.dataToSend.pi,
            id: txId,
            rds_ps: dataHandler.dataToSend.ps.replace(/'/g, "\\'"),
            signal: dataHandler.dataToSend.sig,
            tp: dataHandler.dataToSend.tp,
            ta: dataHandler.dataToSend.ta,
            af_list: dataHandler.dataToSend.af,
        },
        server: {
            uuid: serverConfig.identification.token,
            latitude: serverConfig.identification.lat,
            longitude: serverConfig.identification.lon,
            address: serverConfig.identification.proxyIp.length > 1
                ? serverConfig.identification.proxyIp
                : `Matches request IP with port ${serverConfig.webserver.port}`,
            webserver_name: serverConfig.identification.tunerName.replace(/'/g, "\\'"),
            omid: serverConfig.extras.fmlistOmid || '',
        },
        client: {
            request_ip: clientIp
        },
        type: (req.query.type && dataHandler.dataToSend.txInfo.dist > 700) ? req.query.type : 'tropo',
        log_msg: `Logged PS: ${dataHandler.dataToSend.ps.replace(/\s+/g, '_')}, PI: ${dataHandler.dataToSend.pi}, Signal: ${(dataHandler.dataToSend.sig - 11.25).toFixed(0)} dBµV`
    });

    const options = {
        hostname: 'api.fmlist.org',
        path: '/fmdx.org/slog.php',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        }
    };

    const request = https.request(options, response => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => res.status(200).send(data));
    });

    request.on('error', error => {
        logError('Error sending POST request:', error);
        res.status(500).send(error.message);
    });

    request.write(postData);
    request.end();
});

module.exports = router;
