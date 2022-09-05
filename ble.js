const module = (function () {
    var is_device_connected = false
    var characteristic_configuration_pins = null
    var characteristic_configuration_connection_parameters = null
    var characteristic_output = null
    var characteristic_output_sequence = null
    var characteristic_input = null
    var gatt_server = null

    var configured_pins = []
    var output_pins = []
    var input_pins = []

    var sequence_digital_steps = []

    var sequence_last_delay = 1000

    var last_added_step = undefined

    var output_buttons_ignore = false

    var should_auto_reconnect = false

    var last_current_sequence = null

    function init() {
        if (navigator.bluetooth == undefined) {
            alert('your browser is not supported. Please chose one from the following compatibility matrix.')
            document.location = 'https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API#browser_compatibility'

            return
        }

        $('#button_bluetooth_connect').click(on_bluetooth_button_connect_click)

        $('#button_send_configuration').click(on_button_send_configuraion_click)
        $('#button_sequence_digital_send').click(on_sequence_digital_send_click)
        $('#button-send-conn-params-configuration').click(send_connection_parameters)
        $('#button_sequence_add_step').click((_) => {
            insert_step(0)
        })

        init_connection_parameters()

        window.ble = this

        display_digital_outputs()
        display_digital_inputs()
        display_device_information()
        display_digital_sequence_steps()
        display_pin_configuration_menu()
        display_connection_params_configuration()
    }

    function display_connection_params_configuration() {
        const disable_inputs = characteristic_configuration_connection_parameters == null

        $('#button-send-conn-params-configuration').prop('disabled', disable_inputs)
        $('.input-connection-params-config').each(function (_) {
            this.disabled = disable_inputs
        })

        if (characteristic_configuration_connection_parameters == null) {
            $('#button-send-conn-params-configuration').text('Configuration service not found')
            return
        }

        $('#button-send-conn-params-configuration').text('Send configuration to device')
    }

    async function send_connection_parameters(event) {
        const min_interval = Number($('#input-min-conn-interval').val())
        const max_interval = Number($('#input-max-conn-interval').val())
        const slave_laterncy = Number($('#input-slave-latency').val())
        const supervision_timeout = Number($('#input-supervision-timeout').val())
        const advertising_interval = Number($('#input-advertising-interval').val())

        const array = new Uint16Array(5)

        array[0] = min_interval
        array[1] = max_interval
        array[2] = slave_laterncy
        array[3] = supervision_timeout
        array[4] = advertising_interval

        console.log(array.buffer)

        if (characteristic_configuration_connection_parameters == null) {
            throw 'Connection params characteristic not found'
        }

        try {
            event.target.disabled = true
            await characteristic_configuration_connection_parameters.writeValueWithResponse(array.buffer)
        } catch (e) {
            console.error(e)
        } finally {
            event.target.disabled = false
        }
    }

    function init_connection_parameters() {


        function check_connection_intervals(event) {
            const min_interval = Number($('#input-min-conn-interval').val())
            const max_interval = Number($('#input-max-conn-interval').val())
            const slave_laterncy = Number($('#input-slave-latency').val())
            var supervision_timeout = Number($('#input-supervision-timeout').val())
            const advertising_interval = Number($('#input-advertising-interval').val())

            var min_supervision_timeout = ((max_interval * 2) * (slave_laterncy + 1)) + 10
            min_supervision_timeout = Math.max(100, min_supervision_timeout)

            $('#input-supervision-timeout-label').text(`Supervision timeout (ms) (min. ${min_supervision_timeout})`)

            if (['input-max-conn-interval', 'input-slave-latency'].includes(event.target.id)) {
                supervision_timeout = min_supervision_timeout
                $('#input-supervision-timeout').val(supervision_timeout)
            }

            var encountered_interval_error = false
            var encountered_supervision_error = false
            var encountered_advertising_error = false

            function check_min_conn_interval(interval) {
                if (interval < 8) throw 'Min connection interval too small'
                if (interval > 4000) throw 'Min connection interval too big'
            }
            function check_max_conn_interval(interval) {
                if (interval < 8) throw 'Max connection interval too small'
                if (interval > 4000) throw 'Max connection interval too big'
            }
            function check_slave_latency(slave_laterncy) {
                if (slave_laterncy > 499) throw 'Slave latency too big'
            }
            function check_supervision_timeout(timeout) {
                if (timeout < 100) throw 'Supervision timeout too small'
                if (timeout > 32000) throw 'Supervision timeout too big'
            }
            function check_advertising_interval(interval) {
                if (interval < 20) throw 'Advertising interval too small'
                if (interval > 1024) throw 'Advertising interval too big'
            }

            $('#error-min-conn-interval').text('')
            $('#error-max-conn-interval').text('')
            $('#error-slave-latency').text('')
            $('#error-supervision-timeout').text('')
            $('#error-advertising-interval').text('')

            if (min_interval > max_interval) {
                $('#error-min-conn-interval').text('Min interval needs to be bigger than Max interval')
                $('#error-max-conn-interval').text('Max interval needs to be bigger than Min interval')
                encountered_interval_error = true
            }

            try {
                check_min_conn_interval(min_interval)
            } catch (e) {
                $('#error-min-conn-interval').text(e)
                encountered_interval_error = true
            }

            try {
                check_max_conn_interval(max_interval)
            } catch (e) {
                $('#error-max-conn-interval').text(e)
                encountered_interval_error = true
            }

            try {
                check_slave_latency(slave_laterncy)
            } catch (e) {
                $('#error-slave-latency').text(e)
                encountered_supervision_error = true
            }

            try {
                check_supervision_timeout(supervision_timeout)
            } catch (e) {
                $('#error-supervision-timeout').text(e)
                encountered_supervision_error = true
            }

            try {
                check_advertising_interval(advertising_interval)
            } catch (e) {
                $('#error-advertising-interval').text(e)
                encountered_advertising_error = true
            }

            if (supervision_timeout < min_supervision_timeout) {
                $('#error-supervision-timeout').text(`Supervision smaller than ${min_supervision_timeout}`)
                encountered_supervision_error = true
            }

            var encountered_error = encountered_interval_error || encountered_supervision_error || encountered_advertising_error
            encountered_error ||= (characteristic_configuration_connection_parameters == null)
            $('#button-send-conn-params-configuration').prop('disabled', encountered_error)

            return !encountered_error
        }

        $('#input-min-conn-interval').on('input', check_connection_intervals)
        $('#input-max-conn-interval').on('input', check_connection_intervals)
        $('#input-slave-latency').on('input', check_connection_intervals)
        $('#input-supervision-timeout').on('input', check_connection_intervals)
        $('#input-advertising-interval').on('input', check_connection_intervals)
        /*
        $('#input-min-conn-interval').change(check_connection_intervals)
        $('#input-max-conn-interval').change(check_connection_intervals)
        $('#input-slave-latency').change(check_connection_intervals)
        $('#input-supervision-timeout').change(check_connection_intervals)
        $('#input-advertising-interval').change(check_connection_intervals)
        */
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
                const result = await characteristic_output_sequence.writeValueWithResponse(new Uint8Array(packet))
            }
        }

        if (characteristic_output_sequence.properties.notify) {
            characteristic_output_sequence.addEventListener(
                'characteristicvaluechanged',
                handle_digital_output_sequence_characteristic_changed
            )
            await characteristic_output_sequence.startNotifications()
        }
    }

    async function on_bluetooth_button_connect_click() {
        if (is_device_connected) {
            if (gatt_server == null) {
                alert('GATT server not found. Please reload the page.')
                return
            }
            should_auto_reconnect = false
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
                '00001815-0000-1000-8000-00805f9b34fb', // Automation IO service
                '9c100000-5cf1-8fa7-1549-01fdc1d171dc' // configuration service
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

    async function on_button_send_configuraion_click(_) {
        const payload = encode_pin_configuration(configured_pins)

        if (characteristic_configuration_pins == null) {
            alert('configuration characteristic not found')
            return
        }

        if (!is_device_connected) {
            alert('device lost connection')
            return
        }

        await characteristic_configuration_pins.writeValueWithResponse(new Uint8Array(payload))
        // reset everything since pin count might change
        output_pins = []
        configured_pins = []
        set_device_status('sending configuration...')
    }

    async function reconnect_to_device(device) {
        var error = null
        for (var i = 0; i < 10; i++) {
            var message = 'connecting...'
            if (i > 0) {
                message += ` (attempt ${i}/9)`
            }
            set_device_status(message)
            try {
                await device.gatt.connect()
                await on_bluetooth_gatt_connected(device.gatt)
                return
            } catch (e) {
                console.error(e)
                error = e
            }
        }
        should_auto_reconnect = false
        set_device_status(`connection failed: ${error}`)
        handle_device_disconnect()
    }

    function on_bluetooth_device_selected(device) {
        set_device_name(device.name)

        device.addEventListener('gattserverdisconnected', () => {
            handle_device_disconnect(device)
        })

        should_auto_reconnect = true
        reconnect_to_device(device)
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

        const button_sequence_digital_send = $('#button_sequence_digital_send')
        const button_sequence_ditital_add = $('#button_sequence_add_step')

        if (!is_device_connected) {
            set_device_status('not connected')
            connect_button.text('Connect to device')

            const buttons_to_disable = [
                button_configuration_send,
                button_sequence_digital_send,
            ]

            for (const button of buttons_to_disable) {
                button.text('Device not connected')
                button.prop('disabled', true)
            }

            if (output_pins == []) {
                button_sequence_ditital_add.prop('disabled', true)
            }
            return
        }

        const allow_configuration_send = (characteristic_configuration_pins != null)
        button_configuration_send.prop('disabled', !allow_configuration_send)
        if (allow_configuration_send) {
            button_configuration_send.text('Send to device')
        } else {
            button_configuration_send.text('No configuration characteristic found')
        }

        const allow_output_sequence = characteristic_output_sequence != null
        button_sequence_ditital_add.prop('disabled', !allow_output_sequence)
        button_sequence_digital_send.prop('disabled', !allow_output_sequence)
        if (allow_output_sequence) {
            button_sequence_ditital_add.text('Add first step')
            button_sequence_digital_send.text('Send sequence to device')
        } else {
            button_sequence_ditital_add.text('No output sequence characteristic found')
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

    function insert_step(index) {
        const step = {
            states: Array(output_pins.length).fill(false),
            delay: sequence_last_delay
        }
        sequence_digital_steps.splice(index, 0, step)
        last_added_step = index
        display_digital_sequence_steps()
    }

    function display_digital_sequence_steps() {
        const steps_container = $('#digital_output_sequence_steps')
        steps_container.empty()

        if (sequence_digital_steps.length == 0) {
            $('#button_sequence_add_step').show()
        } else {
            $('#button_sequence_add_step').hide()
        }

        for (var i = 0; i < sequence_digital_steps.length; i++) {
            const step = sequence_digital_steps[i]

            const step_html = `
            <div class="sequence-container">
                    <div class="d-flex button-container" id="button-container">
                    </div>
                    <div class="form-group">
                        <label for="delay">delay: </label>
                        <input type="number" class="form-control" id="input-delay" value="${step.delay}">
                    </div>
                    <div class="d-flex sequence-action-container">
                        <img src="add-before.png" class="sequence-action-button" id="action-add-before"/>
                        <img src="add-after.png" class="sequence-action-button" id="action-add-after"/>
                        <img src="remove.png" class="sequence-action-button" id="action-delete"/>
                    </div>
                </div>
            `
            steps_container.append(step_html)

            const child = steps_container.children().last()

            if (last_added_step != undefined && i == last_added_step) {
                child.focus()
                last_added_step = undefined
            }

            $('#action-add-after', child).click(i, (event) => {
                insert_step(event.data + 1)
            })

            $('#action-add-before', child).click(i, (event) => {
                insert_step(event.data)
            })

            $('#action-delete', child).click(i, (event) => {
                const index = event.data
                sequence_digital_steps.splice(index, 1)
                display_digital_sequence_steps()
            })

            const button_container = $('#button-container', child)
            for (var j = 0; j < step.states.length; j++) {
                var label = '?'
                const output_pin = output_pins[j]
                if (output_pin != undefined && output_pin.pin != undefined) {
                    label = output_pins[j].pin
                }
                var button_html = `
                    <div class="button-pin button-pin-state" id="state-button">
                        <span class="center noclick">${label}</span>
                    </div>`;
                button_container.append(button_html)

                const button = button_container.children().last()

                if (step.states[j]) {
                    button[0].classList.add('pin-high')
                }

                button.click(j, (event) => {
                    const states = step.states
                    const index = event.data
                    states[index] = !states[index]
                    if (states[index]) {
                        event.currentTarget.classList.add('pin-high')
                    } else {
                        event.currentTarget.classList.remove('pin-high')
                    }

                })
            }

            const input_delay = $('#input-delay', child)
            input_delay.change(step, (event) => {
                const delay = Number(event.target.value)
                event.data.delay = delay
                sequence_last_delay = delay
            })
        }
    }

    function create_pin_configuration_dropdown(parent, pin, pin_field, options) {
        const selected = pin[pin_field]
        const button_id = `pin-${pin_field}-button`

        var selected_label = options[0].label
        const selected_option = options
            .find(option => option.value == selected)
        if (selected_option != undefined) {
            selected_label = selected_option.label
        } else {
            pin[pin_field] = options[0].value
        }

        const output_html = `
        <div class="dropdown mb-1">
            <button class="btn btn-primary dropdown-toggle w-100" type="button" id="dropdown-button"
                data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">
                ${selected_label}
            </button>
            <div class="dropdown-menu" aria-labelledby="dropdown-button" id="dropdown-options">
            </div>
        </div>
        `
        parent.append(output_html)

        const child = parent.children().last()


        const dropdown_button = $('#dropdown-button', child)
        const container_options = $('#dropdown-options', child)
        for (const option of options) {
            const option_html = `<a class="dropdown-item">${option.label}</a>`

            container_options.append(option_html)

            const button = container_options
                .children()
                .last()

            button.click(event => {
                pin[pin_field] = option.value
                // dropdown_button.text(option.label)
                display_pin_configuration_menu()
            })
        }
    }

    function display_pin_configuration_menu() {
        const pin_configurations_container = $('#pin-configurations')

        pin_configurations_container.empty()

        pin_configurations_container.empty()
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
                { value: 'disabled', label: 'No pull' },
                { value: 'pullup', label: 'Pullup' },
                { value: 'pulldown', label: 'Pulldown' }
            ]
            const default_high = [
                { value: false, label: 'Default low' },
                { value: true, label: 'Default high' }
            ]

            const parent_html = `
            <div class="pin-configuration-container">
            <h3>Pin ${pin.pin}</h3>
            </div>
            `
            pin_configurations_container.append(parent_html)

            const container = pin_configurations_container.children().last()

            create_pin_configuration_dropdown(container, pin, 'function', functions)
            if (pin.function != 'disabled') {
                create_pin_configuration_dropdown(container, pin, 'invert', invert)

                if (pin.function == 'input') {
                    create_pin_configuration_dropdown(container, pin, 'pull', pulls)
                } else {
                    create_pin_configuration_dropdown(container, pin, 'default_high', default_high)
                }
            }
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

        return characteristic_output.writeValueWithResponse(new Uint8Array(payload))
    }

    async function handle_output_pin_click(event) {
        if (output_buttons_ignore) {
            return
        }

        const index = event.data
        const pin = output_pins[index]
        pin.is_high = !pin.is_high
        if (pin.is_high) {
            event.target.classList.add('pin-high')
        } else {
            event.target.classList.remove('pin-high')
        }
        try {
            set_output_buttons_enabled(false)
            await send_digital_output_pin(index, output_pins[index].is_high)
        } catch (e) {
            set_digital_outputs_text(e)
        } finally {
            set_output_buttons_enabled(true)
        }
    }

    function set_output_buttons_enabled(enabled) {
        output_buttons_ignore = !enabled
        for (const button of $('.button-output')) {
            button.style.opacity = enabled ? 1.0 : 0.3
        }
    }

    function display_digital_outputs() {
        const button_container = $('#digital_output_buttons')
        button_container.empty()
        for (var i = 0; i < output_pins.length; i++) {
            const output_pin = output_pins[i]

            var label = '?'
            if (output_pin.pin != undefined) {
                label = output_pin.pin
            }
            var background_class = ''
            if (output_pin.is_high) {
                background_class = 'pin-high'
            }

            var button_html = `
            <div class="button-pin button-output ${background_class}">
                <span class="center noclick">${label}</span>
            </div>
            `

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

            var label = '?'
            if (input_pin.pin != undefined) {
                label = input_pin.pin
            }
            var background_class = ''
            if (input_pin.is_high) {
                background_class = 'pin-high'
            }

            var button_html = `
            <div class="button-pin ${background_class}">
                <span class="center noclick">${label}</span>
            </div>
            `
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

    function handle_device_disconnect(device) {
        // configured_pins = []
        // output_pins = []
        input_pins = []

        characteristic_configuration_pins = null
        characteristic_configuration_connection_parameters = null
        characteristic_output = null
        characteristic_input = null
        characteristic_output_sequence = null

        is_device_connected = false
        gatt_server = null

        last_current_sequence = null

        display_digital_outputs()
        display_digital_inputs()
        display_pin_configuration_menu()
        display_device_information()
        display_digital_sequence_steps()
        display_connection_params_configuration()

        set_digital_outputs_text('Device not connected')
        set_digital_inputs_text('Device not connected')
        set_output_buttons_enabled(false)

        if (should_auto_reconnect && device != undefined) {
            setTimeout(reconnect_to_device, 3000, device)
        }
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

        set_output_buttons_enabled(true)
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
                const decoded_states = decode_state_bytes(bytes)
                var pin_changed = false
                const input_container = $('#digital_input_buttons')
                for (const state of decoded_states) {
                    if (state.is_high == undefined) {
                        continue
                    }
                    input_pins[state.index].is_high = state.is_high
                    pin_changed = true

                    const input_button = input_container
                        .children()[state.index]
                    if (state.is_high) {
                        input_button.classList.add('pin-high')
                    } else {
                        input_button.classList.remove('pin-high')
                    }
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

    function handle_digital_output_sequence_characteristic_changed(event) {
        const data = event.target.value
        if (data.byteLength != 9) {
            throw ('misformated data from sequence')
            return
        }
        const is_playing = (data.getUint8() == 0x01)

        const children = $('#digital_output_sequence_steps').children()
        if (![undefined, null].includes(last_current_sequence)) {
            last_current_sequence.classList.remove('sequence-current')
        }
        if (!is_playing) {
            return
        }
        const sequence_index = data.getUint32(1, true)
        last_current_sequence = children[sequence_index]
        if (![undefined, null].includes(last_current_sequence)) {
            last_current_sequence.classList.add('sequence-current')
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

        var characteristics = []

        try {
            characteristics = await service.getCharacteristics()
        } catch (e) {
            console.error('no IO characteristics found in device')
        }

        for (const characteristic of characteristics) {
            const uuid = characteristic.uuid
            if (uuid == '00002a56-0000-1000-8000-00805f9b34fb') {
                await handle_digital_characteristic(characteristic)
            } else if (uuid == '9c102a56-5cf1-8fa7-1549-01fdc1d171dc') {
                handle_digital_output_sequence_characteristic(characteristic)
            }
        }

        try {
            const service_configuration = await gatt.getPrimaryService('9c100000-5cf1-8fa7-1549-01fdc1d171dc')

            for (const characteristic of await service_configuration.getCharacteristics()) {
                const uuid = characteristic.uuid
                if (uuid == '9c100001-5cf1-8fa7-1549-01fdc1d171dc') {
                    await handle_pin_configuration_characteristic(characteristic)
                } else if (uuid == '9c100002-5cf1-8fa7-1549-01fdc1d171dc') {
                    await handle_connection_params_characteristic(characteristic)
                }
            }
        } catch (e) {
            console.log(e)
        }

        const output_pin_count = output_pins.length

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

        for (const step of sequence_digital_steps) {
            if (step.states.length > output_pin_count) {
                step.states.splice(output_pin_count)
            } else {
                while (step.states.length < output_pin_count) {
                    step.states.push(false)
                }
            }
        }

        display_digital_sequence_steps()
        display_connection_params_configuration()
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
        characteristic_configuration_pins = characteristic
        characteristic.addEventListener('characteristicvaluechanged', on_pin_configuration_value_changed)
        await characteristic.readValue()
    }

    async function handle_connection_params_characteristic(characteristic) {
        characteristic_configuration_connection_parameters = characteristic
        const result = await characteristic_configuration_connection_parameters.readValue()
        console.log(result)

        const array = new Uint16Array(result.buffer)

        const min_connection_interval = array[0]
        const max_connection_interval = array[1]
        const slave_latency = array[2]
        const supervision_timeout = array[3]
        const advertising_interval = array[4]

        if (min_connection_interval != 0xffff) {
            $('#input-min-conn-interval').val(min_connection_interval)
        }
        if (max_connection_interval != 0xffff) {
            $('#input-max-conn-interval').val(max_connection_interval)
        }
        if (slave_latency != 0xffff) {
            $('#input-slave-latency').val(slave_latency)
        }
        if (supervision_timeout != 0xffff) {
            $('#input-supervision-timeout').val(supervision_timeout)
        }
        if (advertising_interval != 0xffff) {
            $('#input-advertising-interval').val(advertising_interval)
        }
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