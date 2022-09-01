const module = (function () {
    var is_device_connected = false
    var characteristic_configuration = null
    var characteristic_output = null
    var characteristic_output_sequence = null
    var characteristic_input = null
    var expects_disconnect = false
    var gatt_server = null

    var configured_pins = []
    var output_pins = [
        {
            function: 'output',
            invert: false,
            default_high: false
        }
    ]
    var input_pins = []

    var sequence_digital_steps = [
        {
            states: [false, true, false, true, false],
            delay: 0
        },
        {
            states: [true, false, true, false, true],
            delay: 0
        },
    ]

    function init() {
        if (navigator.bluetooth == undefined) {
            alert('your browser is not supported. Please chose one from the following compatibility matrix.')
            document.location = 'https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API#browser_compatibility'

            return
        }

        $('#button_bluetooth_connect').click(on_bluetooth_button_connect_click)

        $('#button_send_configuration').click(on_button_send_configuraion_click)

        $('#button_sequence_digital_clear').click((event) => {
            sequence_digital_steps = []
            display_digital_sequence_steps()
        })
        $('#button_sequence_digital_state_push').click(on_sequence_digital_push_click)
        $('#button_sequence_digital_send').click(on_sequence_digital_send_click)

        window.ble = this

        display_digital_outputs()
        display_digital_sequence_steps()
    }

    function on_sequence_digital_push_click(event) {
        sequence_digital_steps.push({
            states: output_pins.map(pin => pin.is_high),
            delay: 1000
        })
        display_digital_sequence_steps()
    }

    async function on_sequence_digital_send_click(event) {
        for (const step of sequence_digital_steps) {
            if (step.delay <= 0) {
                alert('step delays have to be reater zero')
                return
            }
        }

        const unfiltered_states = sequence_digital_steps.map(step => step.states)
        const filtered_states = filter_states(unfiltered_states)

        var repetitions = $('#sequence_repetition_count').val()
        if (repetitions == '') {
            repetitions = 1
        } else {
            repetitions = Number(repetitions)
        }

        const data = [
            ...encode_varint(repetitions)
        ]

        for (var i = 0; i < filtered_states.length; i++) {
            data.push(...encode_states(filtered_states[i]))
            data.push(...encode_varint(sequence_digital_steps[i].delay))
        }

        const max_packet_length = 19

        const packets = []
        const packets_needed = Math.ceil(data.length / max_packet_length)

        for (var i = 0; i < packets_needed; i++) {
            const packet = [i | 0b10000000] // sequence number with flag indicating that packets will follow
            const current_position = i * max_packet_length
            packet.push(...data.slice(current_position, current_position + max_packet_length))

            packets.push(packet)
        }

        packets[packets.length - 1][0] &= 0b01111111 // unset flag for last packet

        for (const packet of packets) {
            console.log(packet)
            if (characteristic_output_sequence != null) {
                console.log('writing sequence...')
                const result = await characteristic_output_sequence.writeValueWithResponse(new Uint8Array(packet))
                console.log('written sequence...')
            }
        }
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

    function filter_states(states) {
        if (states.length == 0) {
            return []
        }
        if (states.length == 1) {
            return states
        }
        const last_state = [...states[0]]
        const filtered_states = [
            [...states[0]]
        ]

        for (var i = 1; i < states.length; i++) {
            const state = states[i]
            const filtered_state = []

            for (var j = 0; j < state.length; j++) {
                const is_high = state[j]
                if (is_high == last_state[j]) {
                    filtered_state.push(undefined)
                    continue
                }
                filtered_state.push(is_high)
                last_state[j] = is_high
            }
            filtered_states.push(filtered_state)
        }

        return filtered_states
    }

    function encode_states(states) {
        const bytes_needed = Math.ceil(states.length / 4)
        const bytes = Array(bytes_needed).fill(0xff)
        for (var i = 0; i < states.length; i++) {
            const state = states[i]
            if (state == undefined) {
                continue
            }

            const byte_index = Math.floor(i / 4)
            const bit_shift = 6 - ((i * 2) % 8)

            if (state) {
                bytes[byte_index] &= ~(0b10 << bit_shift)
            } else {
                bytes[byte_index] &= ~(0b11 << bit_shift)
            }
        }

        return bytes
    }

    function encode_varint(number) {
        var bits_needed = 1
        if (number != 0) {
            bits_needed = Math.floor(Math.log2(number)) + 1
        }
        const bit_mask = 1 << (bits_needed - 1)
        const bits = []
        for (var i = 0; i < bits_needed; i++) {
            bits.push((number & (bit_mask >> i)) != 0)
        }
        const bytes = []
        const bytes_needed = Math.ceil(bits.length / 7)

        for (var i = 0; i < bytes_needed; i++) {
            var byte = 0x00
            const start_bit_index = bits.length - (i * 7)
            for (var j = 0; j < 7; j++) {
                byte |= bits[start_bit_index - j - 1] << j
            }
            bytes.push(byte)
        }

        for (var i = 0; i < (bytes.length - 1); i++) {
            bytes[i] |= 0b10000000
        }

        return bytes
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

    function encode_pin_configuration(configured_pins) {
        const bytes = []
        for (var i = 0; i < Math.ceil(configured_pins.length / 2); i++) {
            bytes.splice(0, 0, encode_two_pins(
                configured_pins[(i * 2) + 0],
                configured_pins[(i * 2) + 1]
            ))
        }
        // disable pin is count is uneven
        if ((configured_pins.length % 2) == 1) {
            bytes[0] |= 0b11110000
        }

        return bytes
    }

    async function on_button_send_configuraion_click() {
        const payload = encode_pin_configuration(configured_pins)

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
            application_reset()

            if (expects_disconnect) {
                alert('device rebooted. Please reconnect.')
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
            pull: pull_configs[bits & 0b0110],
            invert: ((bits & 0b0001) == 0b0001)
        }
    }

    function set_configuration_visibility() {
        for (const pin of configured_pins) {
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

    function display_device_information() {
        const connect_button = $('#button_bluetooth_connect')
        if (is_device_connected) {
            set_device_status('connected')
            connect_button.text('Disconnect')
        }

        const button_configuration_send = $('#button_send_configuration')

        const button_sequence_digital_state_push = $('#button_sequence_digital_state_push')
        const button_sequence_digital_clear = $('#button_sequence_digital_clear')
        const button_sequence_digital_send = $('#button_sequence_digital_send')

        if (!is_device_connected) {
            set_device_status('not connected')
            connect_button.text('Connect to device')

            const buttons_to_disable = [
                button_configuration_send,
                button_sequence_digital_state_push,
                button_sequence_digital_clear,
                button_sequence_digital_send,
            ]

            for (const button of buttons_to_disable) {
                button.text('Device not connected')
                button.prop('disabled', true)
            }
            return
        }

        var allow_configuration_send = (characteristic_configuration != null)
        button_configuration_send.prop('disabled', !allow_configuration_send)
        if (allow_configuration_send) {
            button_configuration_send.text('Send to device')
        } else {
            button_configuration_send.text('No configuration characteristic found')
        }

        const allow_output_sequence = characteristic_output_sequence != null
        button_sequence_digital_state_push.prop('disabled', !allow_output_sequence)
        button_sequence_digital_clear.prop('disabled', !allow_output_sequence)
        button_sequence_digital_send.prop('disabled', !allow_output_sequence)
        if (allow_output_sequence) {
            button_sequence_digital_state_push.text('Copy current output states')
            button_sequence_digital_clear.text('Clear sequence')
            button_sequence_digital_send.text('Send sequence to device')
        } else {
            button_sequence_digital_state_push.text('No output sequence characteristic found')
            button_sequence_digital_clear.text('No output sequence characteristic found')
            button_sequence_digital_send.text('No output sequence characteristic found')
        }
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
                configured_pins[pin][id] = $(this).is(':checked')
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
                configured_pins[pin][id] = option.value
                on_pin_configuration_changed()
            })
        }

    }

    function on_pin_configuration_changed() {
        set_configuration_visibility()
    }

    function display_digital_sequence_steps() {
        const steps_container = $('#digital_output_sequence_steps')
        steps_container.empty()

        for (const step of sequence_digital_steps) {

            const step_html = `
                <div class="row">
                states: ${step.states.join(', ')}
                </div>

                <div class="row">
                    <div class="col-xs-2">
                        <label for="input_delay">delay (ms):</label> 
                        <input type="number" id="input_delay"/>
                    </div>
                </div>
            `
            steps_container.append(step_html)
            const child = steps_container.children().last()
            const input_delay = $('#input_delay', child)
            input_delay.change(step, (event) => {
                const delay = Number(event.target.value)
                event.data.delay = delay
                console.log(sequence_digital_steps)
            })
        }
    }

    function display_pin_configuration_menu() {
        const pin_configuration_container = $('#pin_configuration')
        pin_configuration_container.empty()
        for (const pin of configured_pins) {
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
            pin_configuration_container.append(select_html)

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

        configured_pins = []

        for (var i = 0; i < bytes.length; i++) {
            const byte = bytes[i]

            configured_pins.push(parse_pin_bits(pin_count - ((i * 2) + 0) - 1, (byte >> 4) & 0b1111))
            configured_pins.push(parse_pin_bits(pin_count - ((i * 2) + 1) - 1, (byte >> 0) & 0b1111))
        }

        configured_pins = configured_pins.reverse()

        set_device_status('read configuration.')

        match_output_pins_to_configuration()
        match_input_pins_to_configuration()
        display_digital_outputs()
        display_digital_inputs()

        display_pin_configuration_menu(configured_pins)
        display_device_information();
    }

    async function send_digital_output_pin(index, state) {
        if (!is_device_connected) {
            throw 'Device not connected'
        }
        if (characteristic_output == null) {
            throw 'Digital output characteristic not present'
        }

        const states = Array(output_pins.length).fill(undefined)
        states[index] = state

        const payload = encode_states(states)

        await characteristic_output.writeValueWithResponse(new Uint8Array(payload))
    }

    async function handle_output_pin_click(event) {
        const index = event.data
        output_pins[index].is_high = !output_pins[index].is_high
        display_digital_outputs()
        try {
            send_digital_output_pin(index, output_pins[index].is_high)
        } catch (e) {
            set_digital_outputs_text(e)
        }
    }

    function display_digital_outputs() {
        const button_container = $('#digital_output_buttons')
        button_container.empty()
        for (var i = 0; i < output_pins.length; i++) {
            const output_pin = output_pins[i]

            var label = null
            if (output_pin.pin != undefined) {
                label = `Pin ${output_pin.pin}`
            } else {
                label = output_pin.is_high ? 'On' : 'Off'
            }
            const background_class = output_pin.is_high ? 'bg-success' : 'bg-secondary'

            var button_html = `<div class="col col-sm ${background_class}">${label}</div>`

            button_container.append(button_html)
            const button = button_container.children().last()
            button.click(i, handle_output_pin_click)
        }
    }


    function display_digital_inputs() {
        const button_container = $('#digital_input_buttons')
        button_container.empty()
        for (var i = 0; i < input_pins.length; i++) {
            const input_pin = input_pins[i]

            var label = null
            if (input_pin.pin != undefined) {
                label = `Pin ${input_pin.pin}`
            } else {
                label = input_pin.is_high ? 'On' : 'Off'
            }
            const background_class = input_pin.is_high ? 'bg-success' : 'bg-secondary'

            var button_html = `<div class="col col-sm ${background_class}">${label}</div>`

            button_container.append(button_html)
        }
    }

    function decode_state_bytes(bytes) {
        const states = []

        const possible_pins = bytes.length * 4
        for (var i = 0; i < possible_pins; i++) {
            const byte_index = Math.floor(i / 4)
            const bit_shift = 6 - ((i * 2) % 8)

            const pin_bits = (bytes[byte_index] >> bit_shift) & 0b11
            states.push({
                index: i,
                is_high: {
                    0b00: false,
                    0b01: true,
                    0b10: undefined,
                    0b11: undefined
                }[pin_bits]
            })
        }

        return states
    }

    function application_reset() {
        configured_pins = []
        output_pins = []
        input_pins = []

        characteristic_configuration = null
        characteristic_output = null
        characteristic_input = null
        characteristic_output_sequence = null

        is_device_connected = false
        gatt_server = null

        display_digital_outputs()
        display_digital_inputs()
        display_pin_configuration_menu()
        display_device_information()

        set_digital_outputs_text('Device not connected')
        set_digital_inputs_text('Device not connected')
    }

    async function handle_digital_output_characteristic(characteristic) {
        characteristic_output = characteristic
        var number_of_digitals_descriptor = null
        try {
            number_of_digitals_descriptor = await characteristic.getDescriptor('00002909-0000-1000-8000-00805f9b34fb')
        } catch (e) {
            console.error(e)
            throw 'Cannot determine digital outputs count'
        }
        const result = await number_of_digitals_descriptor.readValue()
        if (result.byteLength < 1) {
            throw 'Too few output count bytes'
        }
        const output_count = result.getUint8()

        if (output_count == 0) {
            throw 'Too few output pins'
        }

        output_pins = []

        for (var i = 0; i < output_count; i++) {
            output_pins.push({
                is_high: false
            })
        }

        if (characteristic.properties.read) {
            const result = await characteristic.readValue()
            const bytes = new Uint8Array(result.buffer)

            const decoded_state = decode_state_bytes(bytes)
            for (const decoded of decoded_state) {
                if (decoded.is_high == undefined) {
                    continue
                }
                output_pins[decoded.index].is_high = decoded.is_high
            }
        }

        match_output_pins_to_configuration()
        display_digital_outputs()
    }

    async function handle_digital_input_characteristic(characteristic) {
        characteristic_input = characteristic
        var number_of_digitals_descriptor = null
        try {
            number_of_digitals_descriptor = await characteristic.getDescriptor('00002909-0000-1000-8000-00805f9b34fb')
        } catch (e) {
            console.error(e)
            throw 'Cannot determine digital inputs count'
        }
        const result = await number_of_digitals_descriptor.readValue()
        if (result.byteLength < 1) {
            throw 'Too few input count bytes'
        }
        const input_count = result.getUint8()

        if (input_count == 0) {
            throw 'Too few input pins'
        }

        input_pins = []

        for (var i = 0; i < input_count; i++) {
            input_pins.push({
                is_high: false
            })
        }


        if (characteristic.properties.read) {
            const result = await characteristic.readValue()
            const bytes = new Uint8Array(result.buffer)

            const decoded_states = decode_state_bytes(bytes)
            for (const state of decoded_states) {
                if (state.is_high == undefined) {
                    continue
                }
                input_pins[state.index].is_high = state.is_high
            }
        }

        if (characteristic.properties.notify) {
            await characteristic.startNotifications()
            characteristic.addEventListener('characteristicvaluechanged', (event) => {
                const bytes = new Uint8Array(event.target.value.buffer)
                console.log(bytes)
                const decoded_states = decode_state_bytes(bytes)
                console.log(decoded_states)
                var pin_changed = false
                for (const state of decoded_states) {
                    if (state.is_high == undefined) {
                        continue
                    }
                    input_pins[state.index].is_high = state.is_high
                    pin_changed = true
                }
                if (pin_changed) {
                    display_digital_inputs()
                }
            })
        }

        match_input_pins_to_configuration()
        display_digital_inputs()
    }

    async function handle_digital_characteristic(characteristic) {
        const is_output = characteristic.properties.write
        if (is_output) {
            try {
                await handle_digital_output_characteristic(characteristic);
            } catch (e) {
                set_digital_outputs_text(e)
            }
        } else {
            try {
                await handle_digital_input_characteristic(characteristic);
            } catch (e) {
                set_digital_inputs_text(e)
            }
        }
    }

    function handle_digital_output_sequence_characteristic(characteristic) {
        characteristic_output_sequence = characteristic
        display_device_information()
    }

    function set_digital_outputs_text(text) {
        const digital_output_info = $('#info_digital_outputs')
        if (text == '' || text == null) {
            digital_output_info.hide()
        }
        digital_output_info.show()
        digital_output_info.text(text)
    }

    function set_digital_inputs_text(text) {
        const digital_output_info = $('#info_digital_inputs')
        if (text == '' || text == null) {
            digital_output_info.hide()
        }
        digital_output_info.show()
        digital_output_info.text(text)
    }

    async function on_bluetooth_gatt_connected(gatt) {
        is_device_connected = gatt.connected
        gatt_server = gatt
        display_device_information()

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
            } else if (uuid == '00002a56-0000-1000-8000-00805f9b34fb') {
                await handle_digital_characteristic(characteristic)
            } else if (uuid == '9c102a56-5cf1-8fa7-1549-01fdc1d171dc') {
                handle_digital_output_sequence_characteristic(characteristic)
            }
        }

        if (output_pins.length == 0) {
            set_digital_outputs_text('No digital outputs configured')
        } else {
            set_digital_outputs_text('')
        }

        if (input_pins.length == 0) {
            set_digital_inputs_text('No digital inputs configured')
        } else {
            set_digital_inputs_text('')
        }
    }

    function match_input_pins_to_configuration() {
        if (input_pins.length == 0) {
            return
        }
        if (configured_pins.length == 0) {
            return
        }

        var input_pin_index = 0
        for (const configured_pin of configured_pins) {
            if (input_pin_index > input_pins.length) {
                console.error('Pin matching overflow')
                return
            }
            if (configured_pin.function == 'input') {
                input_pins[input_pin_index].pin = configured_pin.pin
                input_pin_index++
            }
        }
    }

    function match_output_pins_to_configuration() {
        if (output_pins.length == 0) {
            return
        }
        if (configured_pins.length == 0) {
            return
        }

        var output_pin_index = 0
        for (const configured_pin of configured_pins) {
            if (output_pin_index > output_pins.length) {
                console.error('Pin matching overflow')
                return
            }
            if (configured_pin.function == 'output') {
                output_pins[output_pin_index].pin = configured_pin.pin
                output_pin_index++
            }
        }
    }

    async function handle_pin_configuration_characteristic(characteristic) {
        set_device_status('reading configuration...')
        characteristic_configuration = characteristic
        characteristic.addEventListener('characteristicvaluechanged', on_pin_configuration_value_changed)
        await characteristic.readValue()
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