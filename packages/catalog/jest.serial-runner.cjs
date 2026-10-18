const { default: Runner } = require("jest-runner");

// A separate runner keeps native watcher tests out of the parallel unit test batch.
module.exports = class SerialRunner extends Runner {
  constructor(...args) {
    super(...args);
    this.isSerial = true;
  }
};
