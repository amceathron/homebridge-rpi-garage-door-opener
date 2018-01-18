/* jshint node: true */
"use strict";
var Service;
var Characteristic;
var DoorState;
var process = require('process');
var rpio = require('rpio');
        
module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  DoorState = homebridge.hap.Characteristic.CurrentDoorState;

  homebridge.registerAccessory("homebridge-rasppi-gpio-garagedoor", "RaspPiGPIOGarageDoor", RaspPiGPIOGarageDoorAccessory);
};

function RaspPiGPIOGarageDoorAccessory(log, config) {
  this.log = log;
  this.version = require('./package.json').version;
  log("RaspPiGPIOGarageDoorAccessory version " + this.version);

  if (process.geteuid() !== 0) {
    log("WARN! WARN! WARN! may not be able to control GPIO pins because not running as root!");
  }

  this.name = config["name"];

  this.doorSwitchPin = config["doorSwitchPin"];
  this.relayOn = config["doorSwitchValue"];
  this.doorSwitchPressTimeInMs = (config["doorSwitchPressTime"] || 0.5) * 1000;
  this.relayIdleInMs = (config["relayIdleTime"] || 0.5) * 1000;
  if (this.doorSwitchPin === undefined || this.relayOn === undefined) {
    log("ERROR! No RELAY. Configuration is not supported.");
    process.exit(1);
  } else {
    this.relayOff = 1-this.relayOn; //opposite of relayOn (O/1)
    log("Door switch pin: " + this.doorSwitchPin);
    log("Door switch val: " + (this.relayOn === 1 ? "ACTIVE_HIGH" : "ACTIVE_LOW"));
    log("Door switch press time in ms: " + this.doorSwitchPressTimeInMs);
    log("Door switch idle time in ms: " + this.relayIdleInMs);
  }

  this.closedDoorSensorPin = config["closedDoorSensorPin"];
  this.closedDoorSensorValue = config["closedDoorSensorValue"];
  if (!this.hasClosedSensor()) {
    log("ERROR! No CLOSED SENSOR. Configuration is not supported.");
    process.exit(1);
  } else {
    log("Door closed sensor: Configured");
    log("    Door closed sensor pin: " + this.closedDoorSensorPin);
    log("    Door closed sensor val: " + (this.closedDoorSensorValue === 1 ? "ACTIVE_HIGH" : "ACTIVE_LOW"));  
  }

  this.openDoorSensorPin = config["openDoorSensorPin"];
  this.openDoorSensorValue = config["openDoorSensorValue"];
  if (this.hasOpenSensor()) {
    log("Door open sensor: Configured");
    log("    Door open sensor pin: " + this.openDoorSensorPin);
    log("    Door open sensor val: " + (this.openDoorSensorValue ===1 ? "ACTIVE_HIGH" : "ACTIVE_LOW"));
  } else {
    log("Door open sensor: Not Configured");
  }

  this.sensorPollInMs = (config["doorPollTime"] || 1) * 1000;
  this.doorOpensInMs = (config["doorOpenTime"] || 15) * 1000;
  log("Sensor poll in ms: " + this.sensorPollInMs);
  log("Door opens in ms: " + this.doorOpensInMs);

  this.initService();
}

RaspPiGPIOGarageDoorAccessory.prototype = {

  initService: function() {
    this.garageDoorOpener = new Service.GarageDoorOpener(this.name,this.name);
    this.currentDoorState = this.garageDoorOpener.getCharacteristic(DoorState);
    this.currentDoorState.on('get', this.getState.bind(this));
    this.targetDoorState = this.garageDoorOpener.getCharacteristic(Characteristic.TargetDoorState);
    this.targetDoorState.on('set', this.setTargetState.bind(this));
    this.targetDoorState.on('get', this.getTargetState.bind(this));

    this.infoService = new Service.AccessoryInformation();
    this.infoService
      .setCharacteristic(Characteristic.Manufacturer, "Opensource Community")
      .setCharacteristic(Characteristic.Model, "RaspPi GPIO GarageDoor")
      .setCharacteristic(Characteristic.SerialNumber, "Version 1.0.0");

    rpio.open(this.doorSwitchPin, rpio.OUTPUT, this.relayOff);
    rpio.open(this.closedDoorSensorPin, rpio.INPUT);
    if (this.hasOpenSensor())
      rpio.open(this.openDoorSensorPin, rpio.INPUT);

    this.cachedState = this.determineCurrentDoorState();
    this.targetState = this.cachedState === DoorState.CLOSED ? DoorState.CLOSED : DoorState.OPEN;
    this.operating = false;
    this.canActivateRelay = true;
    this.setFinalDoorStateTimer = null;
    this.finalStatePollCounter = (this.doorOpensInMs - this.doorOpensInMs % this.sensorPollInMs) / this.sensorPollInMs;
    this.finalStatePollInMs = (this.doorOpensInMs - this.doorOpensInMs % this.finalStatePollCounter) / this.finalStatePollCounter + 1;
    setInterval(this.monitorDoorState.bind(this), this.sensorPollInMs);

    this.log("Initial door state: " + this.doorStateToString(this.cachedState));
    this.currentDoorState.updateValue(this.cachedState);
    this.targetDoorState.updateValue(this.targetState);
  },

  targetDoorStateToString: function(state) {
    switch (state) {
      case DoorState.OPEN:
        return "OPEN";
      case DoorState.CLOSED:
        return "CLOSE";
      default:
        return "UNKNOWN (" + state + ")";
    }
  },

  doorStateToString: function(state) {
    switch (state) {
      case DoorState.OPEN:
        return "OPEN";
      case DoorState.CLOSED:
        return "CLOSED";
      case DoorState.STOPPED:
        return "STOPPED";
      case DoorState.OPENING:
        return "OPENING";
      case DoorState.CLOSING:
        return "CLOSING";
      default:
        return "UNKNOWN (" + state + ")";
    }
  },

  hasOpenSensor : function() {
    return this.openDoorSensorPin !== undefined;
  },

  hasClosedSensor : function() {
    return this.closedDoorSensorPin !== undefined;
  },

  determineCurrentDoorState: function() {
    if (rpio.read(this.closedDoorSensorPin) === this.closedDoorSensorValue)
      return DoorState.CLOSED;
    else if (this.hasOpenSensor())
      return rpio.read(this.openDoorSensorPin) === this.openDoorSensorValue ? DoorState.OPEN : DoorState.STOPPED;
    else
      return DoorState.STOPPED;
  },

  monitorDoorState: function() {
    if (!this.operating) {
      let state = this.determineCurrentDoorState();
      if (this.cachedState !== state) {
        if (state === DoorState.OPEN || state === DoorState.CLOSED) {
          this.targetState = state;
          this.cachedState = state;
        } else {
          this.targetState = (this.cachedState === DoorState.CLOSED ? DoorState.OPEN : DoorState.CLOSED);
          state = (this.targetState === DoorState.CLOSED ? DoorState.CLOSING : DoorState.OPENING);
          this.setFinalDoorState();
        }
        this.log("External device changed door state to " + this.doorStateToString(state));
        this.targetDoorState.updateValue(this.targetState);
        this.currentDoorState.updateValue(state);
      }
    }
  },

  switchOn: function(...args) {
    if (this.canActivateRelay) {
      this.log("Turning on door relay, pin " + this.doorSwitchPin + " = " + this.relayOn);
      this.canActivateRelay = false;
      rpio.write(this.doorSwitchPin, this.relayOn);
      setTimeout(this.switchOff.bind(this), this.doorSwitchPressTimeInMs, ...args);
    }
  },

  switchOff: function(...args) {
    this.log("Turning off door relay, pin " + this.doorSwitchPin + " = " + this.relayOff);
    rpio.write(this.doorSwitchPin, this.relayOff);
    setTimeout(this.okToUseRelay.bind(this), this.relayIdleInMs, ...args);
  },

  okToUseRelay: function(callback, ...args) {
    this.log("Relay available");
    this.canActivateRelay = true;
    if (callback != null)
      callback(...args);
  },

  setFinalDoorState: function(callback, counter) {
    let check = counter != null;
    counter = check? counter : this.finalStatePollCounter;
    this.operating = true;
    let state = this.determineCurrentDoorState();
    if (check && (counter <= 0 || state === DoorState.CLOSED || state === DoorState.OPEN)) {
      if (state === this.targetState) {
        this.log("The door is " + this.doorStateToString(state));
      } else {
        this.log("Was trying to " + this.targetDoorStateToString(this.targetState) + " the door, but it is " + this.doorStateToString(state));
        if (callback != null && state !== DoorState.STOPPED) {
          callback();
          return;
        }
        this.targetState = state === DoorState.CLOSED? DoorState.CLOSED : DoorState.OPEN;
      }
      this.targetDoorState.updateValue(this.targetState);
      this.currentDoorState.updateValue(state);
      this.cachedState = state;
      this.operating = false;
    } else {
      this.setFinalDoorStateTimer = setTimeout(this.setFinalDoorState.bind(this), this.finalStatePollInMs, callback, --counter);
    }
  },

  moveDoors: function(callback) {
    this.switchOn();
    this.setFinalDoorState(callback);
  },

  setTargetState: function(target, callback) {
    let error = null;
    let state = this.determineCurrentDoorState();
    if (target === this.targetState && target === state && !this.operating) {
      this.targetDoorState.updateValue(target);
      this.currentDoorState.updateValue(state);
    } else {
      if (this.canActivateRelay) {
        this.log("Setting target state to " + this.targetDoorStateToString(target));
        clearTimeout(this.setFinalDoorStateTimer);
        this.targetState = target;
        this.currentDoorState.updateValue(target === DoorState.CLOSED ? DoorState.CLOSING : DoorState.OPENING);
        let execute = this.moveDoors.bind(this);
        if (this.operating)
          this.switchOn(execute, execute);
        else
          this.moveDoors(execute);
      } else {
        this.log("Attempting to " + this.targetDoorStateToString(target) + " the door while relay is operating. Ignoring.");
        error = new Error("Ignoring request while the relay is operating");
      }
    }
    callback(error);
  },

  getTargetState: function(callback) {
    callback(null, this.targetState);
  },

  getState: function(callback) {
    let state = this.determineCurrentDoorState();
    this.log("Informing that the door is " + this.doorStateToString(state)); 
    callback(null, state);
  },

  getServices: function() {
    return [this.infoService, this.garageDoorOpener];
  }
};
