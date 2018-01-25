# homebridge-rpi-garage-door-opener
Raspberry Pi GPIO GarageDoor plugin for [Homebridge](https://github.com/nfarina/homebridge)

# Before you start
You will need the following hardware components for your project:
* Raspberry Pi
* Relay that will turn your garage door opener on and off
* Reed switch that will detect when your garage door is closed
* Optional reed switch that will detect when your garage door is fully open. I intend to support configuration without this switch but I have not tested it yet.

If you don't have reed switches or you want to have just one switch that detects when you garage door is fully open. please rather use [homebridge-rasppi-gpio-garagedoor](https://github.com/benlamonica/homebridge-rasppi-gpio-garagedoor).

# Circuit
  This plugin assumes that you are using a Raspberry Pi to directly control your garage door. Garage Door openers usually have
  a switch on the wall that you can push to open the garage door. On my model, this is just a very simple switch that completes
  a 24vdc circuit. The button must be pressed for about a second before the door will open. In order for this to be an effective
  garage door opener, you need two parts, a relay that will perform the duty of the button, and a reed switch that will
  detect when your garage door is closed.

  ![](https://raw.githubusercontent.com/benlamonica/homebridge-rasppi-gpio-garagedoor/master/images/Close_Sensor.jpg)

  ![](https://raw.githubusercontent.com/benlamonica/homebridge-rasppi-gpio-garagedoor/master/images/Relay_Wiring.jpg)

## IMPORTANT NOTE ON PIN SELECTION 
When the Raspberry Pi reboots GPIO pins are reset to their default state. This can cause your garage door to open without you issuing a command. Please make sure you pick the correct pins so that you don't accidentally have your garage door opening after a power loss.

The following pins are pulled HIGH (they output a 3.3 volt signal) on reboot:
* GPIO0/2
* GPIO1/3
* GPIO4
* GPIO7
* GPIO8

GPIO14 is configured as a Serial Transmit line, so avoid choosing that pin.

All other pins are pulled LOW (they have a 0 volt signal, same as GND).

If your relay triggers when the GPIO pin goes LOW, then pick a pin that starts out HIGH on reboot. If your relay triggers with the GPIO PIN goes HIGH then pick a GPIO pin that starts out LOW on reboot.

(information comes from https://www.raspberrypi.org/forums/viewtopic.php?f=44&t=24491)

# Installation
1. [Install Homebridge](https://github.com/nfarina/homebridge/wiki/Running-Homebridge-on-a-Raspberry-Pi)
1. Install this plugin: sudo npm install github:wacekz/homebridge-rpi-garage-door-opener -g
1. [Configure](https://github.com/wacekz/homebridge-rpi-garage-door-opener#configuration) the plugin
1. (Re)start Homebridge

# Configuration

You will need to add the following accessory configuration to the Homebridge [config.json](https://github.com/nfarina/homebridge/blob/master/config-sample.json)

Configuration sample:

 ```
    "accessories": [
        {
            "accessory": "RaspPiGPIOGarageDoor",
            "name": "Garage Door",
            "doorSwitchPin": 7,
            "doorSwitchValue": 0,
            "doorSwitchPressTime": 0.5,
            "doorSwitchIdleTime": 0.5,
            "closedDoorSensorPin": 24,
            "closedDoorSensorValue": 1,
            "closedDoorResistor": 0,
            "openDoorSensorPin": 25,
            "openDoorSensorValue": 1,
            "openDoorResistor": 0,
            "doorPollTime": 1,
            "doorOpenTime": 15
        }
    ],
```
### Note: This plugin uses physical pin numbering.

Fields: 

* name (required) - Can be anything.
* doorSwitchPin (required) - The physical GPIO pin number that controls the relay to trigger the garage door.
* doorSwitchValue (required) - 1 = ACTIVE_HIGH, 0 = ACTIVE_LOW. Set to 0 if you have a relay that requires the signal to be 0v to trigger.
* doorSwitchPressTime (optional) - Number of seconds to trigger the garage door button. Defaults to 0.5 seconds if not specified.
* doorSwitchIdleTime (optional) - Minimum number of seconds between 2 presses of the garage door button. The default value is 0.5 seconds. If doorSwitchPressTime and doorSwitchIdleTime are set to 0.5 seconds and you tap open or close on your phone, the relay will be activated for 0.5 seconds and after that tapping on the phone will be ignored for another 0.5 seconds.
* closedDoorSensorPin (required) - The physical GPIO pin that senses if the door is closed.
* closedDoorSensorValue (optional) - 1 = ACTIVE_HIGH, 0 = ACTIVE_LOW. Defaults to 0 if not specified.
* closedDoorResistor (optional) - 0 (default) = internal pull down and pull up resistors disabled, 1 = internal pull down resistor enabled, 2 = internal pull up resistor enabled. Use 0 if you have external resistor otherwise use 1 if your sensor is connected to 3.3V or use 2 if your sensor is connected to ground.
* openDoorSensorPin (optional) - The physical GPIO pin that senses if the door is open. Do not specify if no sensor is present.
* openDoorSensorValue (optional) - Omit line if you don't have an open sensor. 1 = ACTIVE_HIGH, 0 = ACTIVE_LOW. Defaults to 0 if not specified.
* openDoorResistor (optional) - 0 (default) = internal pull down and pull up resistors disabled, 1 = internal pull down resistor enabled, 2 = internal pull up resistor enabled. Use 0 if you have external resistor otherwise use 1 if your sensor is connected to 3.3V or use 2 if your sensor is connected to ground.
* doorPollTime (optional) - Number of seconds to wait before polling door sensor pins to report if the door is open or closed. Defaults to 1 if not specified.
* doorOpenTime (optional) - Number of seconds it takes your garage door to open or close (err on the side of being longer than it actually takes). Defaults to 15 if not specified.
