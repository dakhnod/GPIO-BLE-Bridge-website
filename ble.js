const module = (function () {
    var pins = []
    var is_device_connected = false
    var characteristic_configuration = null
    var expects_disconnect = false
    var gatt_server = null

    function init() {
        $('#button_bluetooth_connect').click(on_bluetooth_button_connect_click)
        $('#button_send_configuration').click(on_button_send_configuraion_click)

        window.encode_pin_configuration = encode_pin_configuration
        window.encode_pin = encode_pin
        window.encode_two_pins = encode_two_pins
    }

    async function on_bluetooth_button_connect_click() {
        if (is_device_connected) {
            if (gatt_server == null) {
                alert('GATT server not found. Please reload the page.')
                return
            }
            await gatt_server.disconnect()
            return
        }
        navigator.bluetooth.requestDevice({
            filters: [
                {
                    services: [0x1815]
                }
            ],
            // acceptAllDevices: true,
            optionalServices: [
                '00001815-0000-1000-8000-00805f9b34fb'
            ]
        }).then(on_bluetooth_device_selected)
    }

    function encode_pin(pin) {
        var byte = 0b1111

        if (pin == undefined) {
            return byte;
        }

        if (pin.function == 'output') {
            byte = 0b0000
            if (pin.default_high) {
                byte |= 0b0010
            }
        } else if (pin.function == 'input') {
            byte = 0b1000
            if (pin.pull == 'pullup') {
                byte |= 0b0010
            } else if (pin.pull == 'pulldown') {
                byte |= 0b0100
            }
        }

        if (pin.invert) {
            byte |= 0b0001
        }
        return byte;
    }

    function encode_two_pins(pin0, pin1) {
        return (encode_pin(pin0) << 0) | (encode_pin(pin1) << 4);
    }

    function encode_pin_configuration(pins) {
        var bytes = []
        for (var i = 0; i < Math.ceil(pins.length / 2); i++) {
            bytes.splice(0, 0, encode_two_pins(
                pins[(i * 2) + 0],
                pins[(i * 2) + 1]
            ))
        }
        // disable pin is count is uneven
        if ((pins.length % 2) == 1) {
            bytes[0] |= 0b11110000
        }

        return bytes
    }

    async function on_button_send_configuraion_click() {
        console.log('send configuration')

        const payload = encode_pin_configuration(pins)

        console.log(payload)

        if (characteristic_configuration == null) {
            alert('configuration characteristic not found')
            return
        }

        if (!is_device_connected) {
            alert('device lost connection')
            return
        }

        expects_disconnect = true
        await characteristic_configuration.writeValueWithResponse(new Uint8Array(payload))
        set_device_status('sending configuration...')
    }

    function on_bluetooth_device_selected(device) {
        set_device_name(device.name)
        set_device_status('connecting...')

        device.addEventListener('gattserverdisconnected', () => {
            is_device_connected = false
            gatt_server = null
            update_device_information()
            characteristic_configuration = null

            pins = []
            display_pin_configuration_menu(pins)

            if (expects_disconnect) {
                alert('device rebooted. Please reconnet.')
            }
            expects_disconnect = false
        })

        device.gatt.connect()
            .then(on_bluetooth_gatt_connected)
            .catch(on_bluetooth_gatt_connect_except)
    }

    function on_bluetooth_gatt_connect_except(error) {
        console.error(error)
        set_device_status(`connection failed: ${error}`)
    }

    function parse_pin_bits(index, bits) {
        if (bits == 0b1111) {
            return {
                pin: index,
                function: 'disabled'
            }
        }
        if ((bits & 0b1000) == 0b0000) {
            // handling output pin
            return {
                pin: index,
                function: 'output',
                default_high: ((bits & 0b0010) == 0b0010),
                invert: ((bits & 0b0001) == 0b0001)
            }
        }


        const pull_configs = {
            0b0000: 'disabled',
            0b0010: 'pullup',
            0b0100: 'pulldown'
        }
        return {
            pin: index,
            function: 'input',
            pullup: pull_configs[bits & 0b0110],
            invert: ((bits & 0b0001) == 0b0001)
        }
    }

    function set_configuration_visibility() {
        for (const pin of pins) {
            const configuration = $(`#pin-${pin.pin}-configuration`)
            const output_fields = $('.function_output', configuration)
            const input_fields = $('.function_input', configuration)
            const both_fields = $('.function_both', configuration)
            if (pin.function == 'disabled') {
                output_fields.hide()
                input_fields.hide()
                both_fields.hide()
            } else if (pin.function == 'output') {
                output_fields.show()
                input_fields.hide()
                both_fields.show()
            } else if (pin.function == 'input') {
                input_fields.show()
                output_fields.hide()
                both_fields.show()
            }
        }
    }

    function update_device_information() {
        const connect_button = $('#button_bluetooth_connect')
        if (is_device_connected) {
            set_device_status('connected')
            connect_button.text('Disconnect')
        } else {
            set_device_status('not connected')
            connect_button.text('Connect to device')
        }

        const send_button = $('#button_send_configuration')
        var allow_configuration_send = !is_device_connected
        if (is_device_connected) {
            if (characteristic_configuration == null) {
                send_button.text('No configuration characteristic found')
                allow_configuration_send = false
            } else {
                send_button.text('Send to device')
            }
        } else {
            send_button.text('Device not connected')
        }
        send_button.prop('disabled', allow_configuration_send)
    }

    function create_select(id, label, pin_data, options, selected, is_checkbox, function_class = '') {
        const pin = pin_data.pin
        var select_id = `pin-${pin}-${id}`

        var checkbox_string = ''

        if (is_checkbox) {
            if (selected) {
                checkbox_string = `<input type="checkbox" value="" id="${select_id}" checked>`
            } else {
                checkbox_string = `<input type="checkbox" value="" id="${select_id}">`
            }

            const checkbox_html = `
            <div class="row ${function_class}">
                <label for="${select_id}">${label}: </label>
    
                ${checkbox_string}
            </div>`

            $(`#pin-${pin}-configuration`).append(checkbox_html)


            $(`#${select_id}`).change(function () {
                pins[pin][id] = $(this).is(':checked')
                console.log(pins[pin])
                on_pin_configuration_changed()
            })
            return
        }

        var options_string = ''
        for (const option of options) {
            const button_id = `${select_id}-${option.value}`
            if (option.value == selected) {
                options_string += `
                <label class="btn btn-primary active">
                    <input type="radio" id="${button_id}" autocomplete="off" checked> ${option.label}
                </label>
                `
            } else {
                options_string += `
                <label class="btn btn-primary">
                    <input type="radio" id="${button_id}" autocomplete="off"> ${option.label}
                </label>
                `
            }
        }

        const html = `
        <div class="row ${function_class}">
            <label for="${select_id}">${label}: </label>

            <div class="btn-group btn-group-toggle" data-toggle="buttons">
                ${options_string}
            </div>
        </div>`

        $(`#pin-${pin}-configuration`).append(html)

        for (const option of options) {
            const button_id = `${select_id}-${option.value}`
            $(`#${button_id}`).click(() => {
                pins[pin][id] = option.value
                console.log(pins[pin])
                on_pin_configuration_changed()
            })
        }

    }

    function on_pin_configuration_changed() {
        set_configuration_visibility()
    }

    function display_pin_configuration_menu(pins) {
        $('#pin_configuration').empty()
        for (const pin of pins) {
            const functions = [
                { value: 'disabled', 'label': 'Disabled' },
                { value: 'output', label: 'Output' },
                { value: 'input', label: 'Input' }
            ]
            const invert = [
                { value: false, label: 'Not invert' },
                { value: true, label: 'Invert' }
            ]
            const pulls = [
                { value: 'disabled', label: 'No pullup/pulldown' },
                { value: 'pullup', label: 'Pullup' },
                { value: 'pulldown', label: 'Pulldown' }
            ]
            const default_high = [
                { value: false, label: 'Low' },
                { value: true, label: 'High' }
            ]
            const pin_index = pin.pin

            var select_html = `
            <a class="list-group-item">
            <div>
                <div class="col">
                    <div class="row">
                        <h5>Pin ${pin.pin}</h5>
                    </div>

                    <div class="col" id="pin-${pin.pin}-configuration">

                    </div>
                </div>
            </div>
            </a>
            `
            $('#pin_configuration').append(select_html)

            create_select('function', 'Function', pin, functions, pin.function, false)
            create_select('invert', 'Invert', pin, invert, pin.invert, true, 'function_both')
            create_select('pull', 'Pullup/down', pin, pulls, pin.pull, false, 'function_input')
            create_select('default_high', 'Default state', pin, default_high, pin.default_high, false, 'function_output')
        }

        set_configuration_visibility()
    }

    function on_pin_configuration_value_changed(event) {
        const characteristic = event.target
        const value = characteristic.value
        const bytes = new Uint8Array(value.buffer)

        const pin_count = bytes.length * 2

        pins = []

        for (var i = 0; i < bytes.length; i++) {
            const byte = bytes[i]

            pins.push(parse_pin_bits(pin_count - ((i * 2) + 0) - 1, (byte >> 4) & 0b1111))
            pins.push(parse_pin_bits(pin_count - ((i * 2) + 1) - 1, (byte >> 0) & 0b1111))
        }

        pins = pins.reverse()

        set_device_status('read configuration.')

        console.log(pins)

        display_pin_configuration_menu(pins)
        update_device_information();
    }

    async function on_bluetooth_gatt_connected(gatt) {
        is_device_connected = gatt.connected
        gatt_server = gatt
        update_device_information()

        var service = null

        try {
            service = await gatt.getPrimaryService('00001815-0000-1000-8000-00805f9b34fb')
        } catch (e) {
            console.error(e)
            set_device_status('Automation IO Service not found')
            await gatt.disconnect()
            return
        }

        const characteristics = await service.getCharacteristics()

        for (const characteristic of characteristics) {
            const uuid = characteristic.uuid
            if (uuid == '9c100001-5cf1-8fa7-1549-01fdc1d171dc') {
                await handle_pin_configuration_characteristic(characteristic)
            }
        }
    }

    async function handle_pin_configuration_characteristic(characteristic) {
        set_device_status('reading configuration...')
        characteristic_configuration = characteristic
        characteristic.addEventListener('characteristicvaluechanged', on_pin_configuration_value_changed)
        characteristic.readValue()
    }

    function set_device_status(status) {
        $('#info_device_status').text(`Device status: ${status}`)
    }

    function set_device_name(name) {
        $('#info_device_name').text(`Device name: ${name}`)
    }

    return {
        init: init
    }
})()


$(document).ready(module.init)