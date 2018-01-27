# homebridge-rpi-garage-door-opener
Raspberry Pi GPIO garage door plugin for [Homebridge](https://github.com/nfarina/homebridge)

# Before you start
The project modifies a garage door opener that uses a single momentary push button mounted on the wall. The button moves and stops the door and also changes the direction.

# Hardware components
You will need the following hardware components for your project:
* Raspberry Pi
* Relay that will turn your garage door opener on and off
* Reed switch that will detect when your garage door is closed
* Reed switch that will detect when your garage door is fully open

Visit [Wiki](https://github.com/wacekz/homebridge-rpi-garage-door-opener/wiki) to read about hardware setup.

If you don't have reed switches or you want to have just one switch, please rather use [homebridge-rasppi-gpio-garagedoor](https://github.com/benlamonica/homebridge-rasppi-gpio-garagedoor).

# Note about reliability
You may observe incorrect door status on your phone and unexpected behavior of your garage door. It happens because the plugin has very limited knowledge of what is going on with the door. With 2 sensors it only knows when the door is closed or fully open. It does not know what happens between those states especially when you start using wall switches or remote controls while the door is operating.
The plugin tries to recover from such situations. Let me know if it does not.

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
* openDoorSensorPin (required) - The physical GPIO pin that senses if the door is open. Do not specify if no sensor is present.
* openDoorSensorValue (optional) - Omit line if you don't have an open sensor. 1 = ACTIVE_HIGH, 0 = ACTIVE_LOW. Defaults to 0 if not specified.
* openDoorResistor (optional) - 0 (default) = internal pull down and pull up resistors disabled, 1 = internal pull down resistor enabled, 2 = internal pull up resistor enabled. Use 0 if you have external resistor otherwise use 1 if your sensor is connected to 3.3V or use 2 if your sensor is connected to ground.
* doorPollTime (optional) - Number of seconds to wait before polling door sensor pins to report if the door is open or closed. Defaults to 1 if not specified.
* doorOpenTime (optional) - Number of seconds it takes your garage door to open or close (err on the side of being longer than it actually takes). Defaults to 15 if not specified.
