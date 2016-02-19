import UiAutomator2 from 'appium-uiautomator2';
import net from 'net';
import path from 'path';
import _ from 'lodash';
import { errorFromCode } from 'mobile-json-wire-protocol';
import B from 'bluebird';
import { getLogger } from 'appium-logger';


const log = getLogger('AndroidUiAutomator2');
const COMMAND_TYPES = {
  ACTION: 'action',
  SHUTDOWN: 'shutdown'
};

class AndroidUiAutomator2 {
  constructor (adb, systemPort = 4724, webSocket = undefined) {
    this.adb = adb;
    this.systemPort = systemPort;
    this.webSocket = webSocket;
    this.onUnexpectedShutdown = new B(() => {}).cancellable();
  }

  async start (appPackage, disableAndroidWatchers = false, acceptSslCerts = false) {
    try {	
	log.info("Testing=========================== ======================= ISS==start");
      const rootDir = path.resolve(__dirname, '..', '..');
      const startDetector = (s) => { return /Appium Server Ready/.test(s); };
      const uiautomator2Apk = path.resolve(rootDir, 'uiautomator2', 'build',  'outputs', 'appium-uiautomator2-server-debug.apk');
	  const uiautomator2TestApk = path.resolve(rootDir, 'uiautomator2', 'build', 'outputs','appium-uiautomator2-server-debug-androidTest-unaligned.apk');

      await this.init();
      this.adb.forwardPort(this.systemPort, this.systemPort);
      this.process = await this.uiAutomator2.start(
                       uiautomator2Apk, uiautomator2TestApk, 'io.appium.uiautomator2.AppiumUiAutomator2Server',
                       startDetector, '-e', 'pkg', appPackage,
                       '-e', 'disableAndroidWatchers', disableAndroidWatchers,
                       '-e', 'acceptSslCerts', acceptSslCerts);	     

   
     return await new Promise ((resolve, reject) => {
        try {
          this.socketClient = net.connect(this.systemPort);
          this.socketClient.once('connect', () => {
            log.info("Android uiAutomator2 socket is now connected");
            resolve();
          });
        } catch (err) {
          reject(err);
        }
      });
    } catch (err) {
      log.errorAndThrow(`Error occured while starting AndroidUiautomator2. Original error: ${err}`);
    }
  }

  async sendCommand (type, extra = {}) {
    if (!this.socketClient) {
      throw new Error('Socket connection closed unexpectedly');
    }

    return await new Promise ((resolve, reject) => {
      let cmd = Object.assign({cmd: type}, extra);
      let cmdJson = `${JSON.stringify(cmd)} \n`;
      log.debug(`Sending command to android: ${_.trunc(cmdJson, 1000).trim()}`);
      this.socketClient.write(cmdJson);
      this.socketClient.setEncoding('utf8');
      let streamData = '';
      this.socketClient.on('data', (data) => {
        log.debug("Received command result from uiAutomator2");
        try {
          streamData = JSON.parse(streamData + data);
          // we successfully parsed JSON so we've got all the data,
          // remove the socket listener and evaluate
          this.socketClient.removeAllListeners('data');
          if (streamData.status === 0) {
            resolve(streamData.value);
          }
          reject(errorFromCode(streamData.status));
        } catch (ign) {
          log.debug("Stream still not complete, waiting");
          streamData += data;
        }
      });
    });
  }

  async sendAction (action, params = {}) {
    let extra = {action, params};
    return await this.sendCommand(COMMAND_TYPES.ACTION, extra);
  }

  async shutdown () {
    if (!this.uiAutomator2) {
      log.warn("Cannot shut down Android uiAutomator2; it has already shut down");
      return;
    }

    // remove listners so we don't trigger unexpected shutdown
    this.uiAutomator2.removeAllListeners(UiAutomator2.EVENT_CHANGED);
    if (this.socketClient) {
      await this.sendCommand(COMMAND_TYPES.SHUTDOWN);
    }
    await this.uiAutomator2.shutdown();
    this.uiAutomator2 = null;
  }

  // this helper function makes unit testing easier.
  async init () {
    this.uiAutomator2 = new UiAutomator2(this.adb);
  }
}

export { AndroidUiAutomator2, COMMAND_TYPES };
export default AndroidUiAutomator2;
