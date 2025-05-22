// server/stream/index.js

const { spawn, execSync } = require('child_process');
const { configName, serverConfig, configUpdate, configSave, configExists } = require('../server_config');
const { logDebug, logError, logInfo, logWarn, logFfmpeg } = require('../console');
const checkFFmpeg = require('./checkFFmpeg');

let ffmpeg;    // wird von checkFFmpeg() gesetzt
let ffmpegParams;

/**
 * Prüft auf macOS nach SoX (rec) und unter Linux nach arecord.
 * Beendet das Programm mit Fehler, falls die jeweiligen Tools fehlen.
 */
function checkAudioUtilities() {
  if (process.platform === 'darwin') {
    try {
      execSync('which rec');
    } catch {
      logError('[Audio Utility Check] SoX ("rec") nicht gefunden. Bitte installieren: brew install sox');
      process.exit(1);
    }
  } else if (process.platform === 'linux') {
    try {
      execSync('which arecord');
    } catch {
      logError('[Audio Utility Check] ALSA ("arecord") nicht gefunden. Bitte installieren: pkg install alsa-utils');
      process.exit(1);
    }
  }
}

/**
 * Baut je nach Plattform und serverConfig den kompletten Kommando-String
 * für den Audio-Stream (ffmpeg | rec | arecord).
 */
function buildCommand() {
  // Basis-Optionen für ffmpeg
  const baseFlags = '-fflags +nobuffer+flush_packets -flags low_delay -rtbufsize 6192 -probesize 32';
  const codec    = `-acodec pcm_s16le -ar 48000 -ac ${serverConfig.audio.audioChannels}`;
  const output   = `${serverConfig.audio.audioBoost && serverConfig.audio.ffmpeg
                    ? '-af "volume=3.5"' : ''} -f s16le -packetsize 384 -flush_packets 1 -bufsize 960`;

  const portArg = serverConfig.webserver.webserverPort + 10;
  const nodeStream = ` | node server/stream/3las.server.js -port ${portArg} -samplerate 48000 -channels ${serverConfig.audio.audioChannels}`;

  if (process.platform === 'win32') {
    logInfo('[Audio Stream] Windows – dshow input');
    const exe = `"${ffmpeg.replace(/\\/g, '\\\\')}"`;
    return `${exe} ${baseFlags} -f dshow -audio_buffer_size 200 -i audio="${serverConfig.audio.audioDevice}" ` +
           `${codec} ${output} pipe:1${nodeStream}`;

  } else if (process.platform === 'darwin') {
    if (!serverConfig.audio.ffmpeg) {
      logInfo('[Audio Stream] macOS – coreaudio via rec');
      return `rec -t coreaudio -b 32 -r 48000 -c ${serverConfig.audio.audioChannels} -t raw - |` +
             ` node server/stream/3las.server.js -port ${portArg} -samplerate 48000 -channels ${serverConfig.audio.audioChannels}`;
    } else {
      logInfo('[Audio Stream] macOS – ffmpeg über ALSA');
      ffmpegParams = `${baseFlags} -f alsa -i "${serverConfig.audio.softwareMode ? 'plug:' : ''}${serverConfig.audio.audioDevice}" ` +
                     `${codec} ${output} -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 10 pipe:1${nodeStream}`;
      return `${ffmpeg} ${ffmpegParams}`;
    }

  } else { // Linux
    if (!serverConfig.audio.ffmpeg) {
      logInfo('[Audio Stream] Linux – ALSA via arecord');
      const dev = `${serverConfig.audio.softwareMode ? 'plug:' : ''}${serverConfig.audio.audioDevice}`;
      return `while true; do arecord -D "${dev}" -f S16_LE -r 48000 -c ${serverConfig.audio.audioChannels} -t raw -; done${nodeStream}`;
    } else {
      logInfo('[Audio Stream] Linux – ffmpeg über ALSA');
      ffmpegParams = `${baseFlags} -f alsa -i "${serverConfig.audio.softwareMode ? 'plug:' : ''}${serverConfig.audio.audioDevice}" ` +
                     `${codec} ${output} -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 10 pipe:1${nodeStream}`;
      return `${ffmpeg} ${ffmpegParams}`;
    }
  }
}

/**
 * Startet den Audio-Stream, indem das zuvor gebaute Kommando in einer Shell ausgeführt wird.
 * Loggt stdout/err und überprüft den Streaming-Start anhand der ffmpeg-Ausgabe.
 */
function enableAudioStream() {
  const command = buildCommand();
  let started = false;

  if (!serverConfig.audio.audioDevice || serverConfig.audio.audioDevice.length < 2) {
    logWarn('[Audio Stream] Kein Audio-Gerät konfiguriert – überspringe Streaming.');
    return;
  }

  logInfo(`[Audio Stream] Kommando:\n${command}`);
  logInfo(`[Audio Stream] Port: ${serverConfig.webserver.webserverPort + 10}`);
  logInfo(`[Audio Stream] Using ${ffmpeg === 'ffmpeg' ? 'system-installed FFmpeg' : 'ffmpeg-static (Entfernt!)'}`);

  const child = spawn(command, { shell: true });

  child.stdout.on('data', data => logFfmpeg(`[stream:stdout] ${data}`));
  child.stderr.on('data', data => {
    const text = data.toString();
    logFfmpeg(`[stream:stderr] ${text}`);
    if (text.includes('I/O error')) {
      logError(`[Audio Stream] Gerät "${serverConfig.audio.audioDevice}" konnte nicht geöffnet werden.`);
      logError('Starte mit `node . --ffmpegdebug` für mehr Details.');
    }
    if (text.match(/size=\s*\d+/) && !started) {
      logInfo('[Audio Stream] Stream erfolgreich gestartet.');
      started = true;
    }
  });

  child.on('close', code => logFfmpeg(`[Audio Stream] Kindprozess beendet mit Code ${code}`));
  child.on('error', err  => logFfmpeg(`[Audio Stream] Fehler beim Starten des Kindprozesses: ${err}`));
}

// Wenn Konfiguration existiert, prüfen wir ffmpeg und starten dann den Stream
if (configExists()) {
  checkFFmpeg()
    .then(cmd => {
      ffmpeg = cmd;
      if (!serverConfig.audio.ffmpeg) checkAudioUtilities();
      enableAudioStream();
    })
    .catch(err => {
      console.error(err.message);
      process.exit(1);
    });
}
