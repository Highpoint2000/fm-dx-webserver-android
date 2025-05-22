const { spawn } = require('child_process');

/**
 * Prüft, ob eine System-Installation von ffmpeg verfügbar ist.
 * Liefert bei Erfolg den String 'ffmpeg', andernfalls wird ein Error geworfen.
 */
function checkFFmpeg() {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-version'], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });

    proc.on('error', () => {
      reject(new Error(
        'ffmpeg wurde nicht gefunden. Bitte installiere es in Termux mit: pkg install ffmpeg'
      ));
    });

    proc.on('exit', (code) => {
      if (code === 0) {
        resolve('ffmpeg');
      } else {
        reject(new Error(
          'ffmpeg existiert zwar, aber "ffmpeg -version" liefert einen Fehler. ' +
          'Überprüfe deine Installation oder installiere neu mit: pkg install ffmpeg'
        ));
      }
    });
  });
}

module.exports = checkFFmpeg;
