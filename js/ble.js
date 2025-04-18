import { 
    gpio_asm_compile, 
    set_gpio_asm_message, 
    gpio_asm_file_read 
} from "./modules/gpioasm.js"

import { 
    set_device_battery_level, 
    set_device_firmware_version, 
    set_device_name, 
    set_device_status 
} from "./modules/ui.js"

import { 
    filter_states,
    encode_states,
    encode_pin_configuration
} from "./modules/encoders.js"

const module = (function () {
    var is_device_connected = false
    var characteristic_configuration_pins = null
    var characteristic_configuration_connection_parameters = null
    var characteristic_output = null
    var characteristic_input = null
    var characteristic_gpio_asm_data = null
    var gatt_server = null

    var configured_pins = []
    var output_digital_pins = []
    var output_analog_pins = []
    var input_pins = []

    var device_firmware_version = undefined

    var sequence_digital_steps = []

    var sequence_last_delay = 1000

    var last_added_step = undefined

    var output_buttons_ignore = false

    var should_auto_reconnect = false

    var last_current_sequence = null

    let gpioasmPackets = undefined

    function init() {
        $('#gpio-asm-file-upload').change(handle_gpio_asm_upload)
        
        if (navigator.bluetooth == undefined) {
            $('#button_bluetooth_connect').prop('disabled', true)
            $('#bluetooth-hint').show()
            return
        }

        $('#button_bluetooth_connect').click(on_bluetooth_button_connect_click)
        $('#button_send_configuration').click(on_button_send_configuraion_click)
        $('#button-sequence-digital-send').click(on_sequence_digital_send_click)
        $('#button-send-conn-params-configuration').click(send_connection_parameters)
        $('#gpio-asm-upload-button').click(on_button_gpio_asm_upload_click)
        $('#button-sequence-add-step').click((_) => {
            insert_step(0)
        })

        init_connection_parameters()

        window.ble = this

        display_outputs_digital()
        display_outputs_analog()
        display_inputs_digital()
        display_device_information()
        display_digital_sequence_steps()
        display_pin_configuration_menu()
        display_connection_params_configuration()

        fetch('boards.json')
            .then(response => response.json())
            .then(display_pre_select_dropdown)
    }

    function pre_select_board(board) {
        var pin_index = 0
        configured_pins = []
        for (const pin of board.pins) {
            for (var j = pin_index; j < pin.pin; j++) {
                configured_pins.push({
                    pin: j,
                    function: 'disabled'
                })
            }
            pin_index = pin.pin + 1
            configured_pins.push(pin)
        }
        const hardwarePinCount = board.hardware_pin_count ?? 32
        for (; pin_index < hardwarePinCount; pin_index++) {
            configured_pins.push({
                pin: pin_index,
                function: 'disabled'
            })
        }
        display_pin_configuration_menu()
    }


    function create_upload_packet_data_handler(characteristic) {
        return async function (data) {
            try {
                const packets = split_data_into_packets(data, 19)
                for (var i = 0; i < packets.length; i++) {
                    set_gpio_asm_message(`sending packet ${i + 1}/${packets.length}`)
                    const packet = packets[i]
                    await characteristic.writeValueWithResponse(new Uint8Array(packet))
                }
                set_gpio_asm_message('all packets sent.')
            } catch (e) {
                set_gpio_asm_message(e)
            }
        }
    }

    async function on_button_gpio_asm_upload_click() {
        try {
            if (characteristic_gpio_asm_data == undefined) {
                throw 'no gpioASM data characteristic found'
            }

            if (gpioasmPackets == undefined) {
                throw 'gpioASM not compiled yet'
            }

            for (var i = 0; i < gpioasmPackets.length; i++) {
                set_gpio_asm_message(`sending packet ${i + 1}/${gpioasmPackets.length}`)
                const packet = gpioasmPackets[i]
                await characteristic_gpio_asm_data.writeValueWithResponse(new Uint8Array(packet))
            }
            set_gpio_asm_message('all packets sent.')
        } catch (e) {
            set_gpio_asm_message(e)
        }
    }

    function bytesToHex(data) {
        return data
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join('')
    }

    function display_gpioasm_code(data) {
        const fileInfoContainer = $('#gpio-asm-file-info')
        fileInfoContainer.text(`Compiled gpioASM code: ${bytesToHex(data)}`)
        gpioasmPackets = split_data_into_packets(data, 19)
        for (const i in gpioasmPackets) {
            fileInfoContainer.append(`<div>packet #${i}: ${bytesToHex(gpioasmPackets[i])}</div>`)
        }
    }

    function handle_gpio_asm_upload(event) {
        try {
            gpio_asm_file_read(display_gpioasm_code)
            $('#gpio-asm-upload-button').prop('disabled', false)
        } catch (e) {
            set_gpio_asm_message(e)
            console.log('disabling button')
            $('#gpio-asm-upload-button').prop('disabled', true)
        }

        $('#gpio-asm-file-upload').val(null)
    }

    function display_pre_select_dropdown(boards) {
        const container = $('#container-pre-select')

        for (const board of boards) {
            const html = `
            <div class="pre-select-option m-2">
                <h4>${board.label}</h4>
                <img class="mw-100" src="${board.image_url}"/>
            </div>`
            const option = $(html)
            option.click(_ => pre_select_board(board))
            container.append(option)
        }
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

    function create_input_range_limiter(min, max) {
        return function (event) {
            const target = event.currentTarget
            const value = target.value
            if (value == '') {
                return
            }
            const num = Number(value)
            if (num > max) {
                target.value = max
            } else if (num < min) {
                target.value = min
            }
        }
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

    function split_data_into_packets(data, max_packet_length) {
        const packets = []
        const packets_needed = Math.ceil(data.length / max_packet_length)

        for (var i = 0; i < packets_needed; i++) {
            const packet = [i | 0b10000000] // sequence number with flag indicating that packets will follow
            const current_position = i * max_packet_length
            packet.push(...data.slice(current_position, current_position + max_packet_length))

            packets.push(packet)
        }

        packets[packets.length - 1][0] &= 0b01111111 // unset flag for last packet

        return packets
    }

    async function on_sequence_digital_send_click(event) {
        for (const step of sequence_digital_steps) {
            if (step.delay < 0) {
                alert('step delays have to be greater or equal to zero')
                return
            }
        }

        if(localStorage != undefined){
            const device_name = gatt_server.device.name
            const key = `sequence_${device_name}`
            const value = JSON.stringify(sequence_digital_steps)
            localStorage.setItem(key, value)
        }else{
            console.error('no access to localstorage')
        }

        const unfiltered_states = sequence_digital_steps.map(step => step.states)
        const unfiltered_output_analog_values = sequence_digital_steps.map(step => step.output_analog_values)
        const filtered_states = unfiltered_states
        const filtered_output_analog_values = filter_states(unfiltered_output_analog_values)

        var repetitions = $('#sequence-repetition-count').val()
        if (repetitions == '') {
            repetitions = 1
        } else {
            repetitions = Number(repetitions)
        }

        const instructions = [{
            instruction: 'label',
            args: ['start']
        }]

        for (var i = 0; i < filtered_states.length; i++) {
            const states = filtered_states[i]
            instructions.push({
                instruction: 'write_digital',
                args: [
                    states.map(function (state) {
                        if (state == null) {
                            return 'i'
                        }
                        if (state) {
                            return '1'
                        }
                        return '0'
                    }).join('')
                ]
            })

            const analog_values = filtered_output_analog_values[i]
            for(var j = 0; j < analog_values.length; j++){
                const value = analog_values[j]
                if(value == undefined){
                    continue
                }
                instructions.push({
                    instruction: `write_analog_channel_${j}`,
                    args: [value]
                })
            }

            const delay = sequence_digital_steps[i].delay
            if (delay > 0) {
                instructions.push({
                    instruction: 'sleep_ms',
                    args: [delay]
                })
            }
        }

        if (repetitions == 0) {
            instructions.push({
                instruction: 'jump',
                args: ['start']
            })
        } else if(repetitions > 1) {
            instructions.push({
                instruction: 'jump_count',
                args: ['start', repetitions - 1]
            })
        }

        const data = gpio_asm_compile(instructions)

        display_gpioasm_code(data)

        const max_packet_length = 19

        const packets = split_data_into_packets(data, max_packet_length);

        for (const packet of packets) {
            if (characteristic_gpio_asm_data != null) {
                const result = await characteristic_gpio_asm_data.writeValueWithResponse(new Uint8Array(packet))
            }
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
                // '00001800-0000-1000-8000-00805f9b34fb', // generic attribute service
                '0000180a-0000-1000-8000-00805f9b34fb', // device information service
                '0000180f-0000-1000-8000-00805f9b34fb', // battery service
                '00001815-0000-1000-8000-00805f9b34fb', // Automation IO service
                '9c100000-5cf1-8fa7-1549-01fdc1d171dc', // configuration service
                'b1190000-2a74-d5a2-784f-c1cdb3862ab0' // gpioASM service
            ]
        }).then(on_bluetooth_device_selected)
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
        output_digital_pins = []
        // configured_pins = []
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
        device.addEventListener('gattserverdisconnected', () => {
            handle_device_disconnect(device)
        })

        should_auto_reconnect = true
        reconnect_to_device(device)
    }

    function decode_pin_bits(index, bits) {
        if (bits == 0b1111) {
            return {
                pin: index,
                function: 'disabled'
            }
        }
        if ((bits & 0b1000) == 0b0000) {
            // handling output pin
            var pin = {
                pin: index,
                function: 'output',
                function_output: 'analog',
                invert: ((bits & 0b0001) == 0b0001)
            }
            if ((bits & 0b0100) == 0b0000) {
                pin.function_output = 'digital',
                    pin.default_high = ((bits & 0b0010) == 0b0010)
            }
            return pin
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

        const button_sequence_digital_send = $('#button-sequence-digital-send')
        const button_sequence_ditital_add = $('#button-sequence-add-step')

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

            if (output_digital_pins == []) {
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

        const allow_output_sequence = characteristic_gpio_asm_data != null
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

    function on_pin_configuration_changed() {
        set_configuration_visibility()
    }

    function insert_step(index) {
        const step = {
            states: Array(output_digital_pins.length).fill(false),
            output_analog_values: Array(output_analog_pins.length).fill(undefined),
            delay: sequence_last_delay
        }
        sequence_digital_steps.splice(index, 0, step)
        last_added_step = index
        display_digital_sequence_steps()
    }

    function display_digital_sequence_steps() {
        const steps_container = $('#digital-output-sequence-steps')
        steps_container.empty()

        if (sequence_digital_steps.length == 0) {
            $('#button-sequence-add-step').show()
        } else {
            $('#button-sequence-add-step').hide()
        }

        for (var i = 0; i < sequence_digital_steps.length; i++) {
            const step = sequence_digital_steps[i]

            const step_html = `
            <div class="sequence-container">
                <div class="d-flex button-container" id="button-container">
                </div>

                <div class="form-group">
                    <label for="delay">delay (ms): </label>
                    <input type="number" class="form-control" id="input-delay" value="${step.delay}">
                </div>
            </div>
            `

            const child = $(step_html)

            steps_container.append(child)

            for (var j = 0; j < output_analog_pins.length; j++) {
                const pin = output_analog_pins[j]
                const label = pinIndexToLabel(pin.pin)

                var value = ''
                if (step.output_analog_values[j] != undefined) {
                    value = step.output_analog_values[j]
                }

                const analog_html = `
                <div class="form-group">
                    <label for="pwm-duty-cycle">Pin ${label} duty cycle (us)</label>
                    <input class="form-control" type="number" id="pwm-duty-cycle" value="${value}">
                </div>`

                const form = $(analog_html)

                child.append(form)

                const current_value_index = j
                $('#pwm-duty-cycle', form).on('input', event => {
                    const input = event.currentTarget
                    const value = input.value
                    if (value == '') {
                        step.output_analog_values[current_value_index] = undefined
                        return
                    }
                    var duty_cycle = Number(value)
                    if (duty_cycle < 0) {
                        duty_cycle = 0
                        input.value = duty_cycle
                    } else if (duty_cycle > 20000) {
                        duty_cycle = 20000
                        input.value = duty_cycle
                    }

                    step.output_analog_values[current_value_index] = duty_cycle
                })
            }

            const action_buttons_html = `
            <div class="d-flex sequence-action-container">
                <img src="add-before.png" class="sequence-action-button" id="action-add-before"/>
                <img src="add-after.png" class="sequence-action-button" id="action-add-after"/>
                <img src="remove.png" class="sequence-action-button" id="action-delete"/>
            </div>`

            child.append(action_buttons_html)

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
                const output_pin = output_digital_pins[j]
                if (output_pin != undefined && output_pin.pin != undefined) {
                    label = output_pin.pin
                }
                const button_html = `
                    <div class="button-pin button-pin-state" id="state-button">
                        <span class="center noclick">${label}</span>
                    </div>`;

                const button = $(button_html)

                button_container.append(button)

                if (step.states[j]) {
                    button[0].classList.add('pin-high')
                }else if(step.states[j] === null) {
                    button[0].classList.add('pin-high-impedance')
                }

                button.click(j, (event) => {
                    const states = step.states
                    const index = event.data
                    states[index] = !states[index]

                    event.currentTarget.classList.remove('pin-high-impedance')
                    if (states[index]) {
                        event.currentTarget.classList.add('pin-high')
                    } else {
                        event.currentTarget.classList.remove('pin-high')
                    }
                })

                button.on('contextmenu', j, (event) => {
                    event.currentTarget.classList.add('pin-high-impedance')
                    step.states[event.data] = null
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

        const child = $(output_html)

        parent.append(child)

        const container_options = $('#dropdown-options', child)
        for (const option of options) {
            const option_html = `<a class="dropdown-item">${option.label}</a>`

            const button = $(option_html)

            container_options.append(button)

            button.click(event => {
                pin[pin_field] = option.value
                if(pin_field === 'pull') {
                    pin.invert = (option.value == 'pullup')
                }
                // dropdown_button.text(option.label)
                display_pin_configuration_menu()
            })
        }
    }

    function pinIndexToLabel(pin) {
        if(pin == undefined) {
            return '?'
        }
        return `${Math.floor(pin / 32)}.${String(pin % 32).padStart(2, '0')}`
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
            const functions_output = [
                { value: 'digital', label: 'Digital' },
                { value: 'analog', label: 'Analog' }
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
            <h3>Pin ${pinIndexToLabel(pin.pin)}</h3>
            </div>
            `

            const container = $(parent_html)

            pin_configurations_container.append(container)

            create_pin_configuration_dropdown(container, pin, 'function', functions)
            if (pin.function != 'disabled') {
                if (pin.function == 'input') {
                    create_pin_configuration_dropdown(container, pin, 'pull', pulls)
                } else {
                    create_pin_configuration_dropdown(container, pin, 'function_output', functions_output)
                    if (pin.function_output != 'analog') {
                        create_pin_configuration_dropdown(container, pin, 'default_high', default_high)
                    }
                }

                create_pin_configuration_dropdown(container, pin, 'invert', invert)
            }
        }

        set_configuration_visibility()
    }

    async function send_digital_output_pin(index, state) {
        if (!is_device_connected) {
            throw 'Device not connected'
        }
        if (characteristic_output == null) {
            throw 'Digital output characteristic not present'
        }

        const states = Array(output_digital_pins.length).fill('-')
        states[index] = state ? '1': '0'

        const payload = encode_states(states)

        return characteristic_output.writeValueWithResponse(new Uint8Array(payload))
    }

    async function handle_output_pin_click(event) {
        if (output_buttons_ignore) {
            return
        }

        const index = event.data
        const pin = output_digital_pins[index]
        pin.is_high = !pin.is_high
        if (pin.is_high) {
            event.target.classList.add('pin-high')
        } else {
            event.target.classList.remove('pin-high')
        }
        try {
            set_output_buttons_enabled(false)
            await send_digital_output_pin(index, pin.is_high)
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

    function display_outputs_digital() {
        const button_container = $('#digital_output_buttons')
        button_container.empty()
        for (var i = 0; i < output_digital_pins.length; i++) {
            const output_pin = output_digital_pins[i]

            const label = pinIndexToLabel(output_pin.pin)

            var background_class = ''
            if (output_pin.is_high) {
                background_class = 'pin-high'
            }

            const button_html = `
            <div class="button-pin button-output ${background_class}">
                <span class="center noclick">${label}</span>
            </div>
            `
            const button = $(button_html)
            button_container.append(button)
            button.click(i, handle_output_pin_click)
        }
    }

    function display_outputs_analog() {
        const container = $('#outputs-analog-container')
        container.empty()
        for (const pin of output_analog_pins) {
            const label = pinIndexToLabel(pin.pin)
            var value = ''

            if (pin.value != undefined) {
                value = pin.value
            }

            const pin_html = `
            <div class="pin-configuration-container">
                <h3>Pin ${label}</h3>
                <div class="form-group">
                    <label for="pwm-duty-cycle">Duty cycle (0us - 20000us)</label>
                    <input class="form-control" type="number" id="pwm-duty-cycle" value="${value}">
                    <button class="btn btn-primary w-100 mt-3" id="value-send">Send value</button>
                </div>
            </div>`
            const child = $(pin_html)
            container.append(child)

            const button = $('#value-send', child)
            const edit_value = $('#pwm-duty-cycle', child)

            edit_value.on('input', create_input_range_limiter(0, 20000))

            button.click(async function (event) {
                const value = edit_value.val()
                if (value == '') {
                    return
                }

                if (pin.output_analog_characteristic == undefined) {
                    throw 'could not find analog output characteristic'
                }

                const payload = new Uint16Array(1)
                payload[0] = Number(value)

                await pin.output_analog_characteristic.writeValueWithResponse(payload.buffer)
            })
        }
    }


    function display_inputs_digital() {
        const button_container = $('#digital_input_buttons')
        button_container.empty()
        for (var i = 0; i < input_pins.length; i++) {
            const input_pin = input_pins[i]

            const label = pinIndexToLabel(input_pin.pin)
            var background_class = ''
            if (input_pin.is_high) {
                background_class = 'pin-high'
            }

            const button_html = `
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
            const bit_shift = ((i * 2) % 8)

            const pin_bits = (bytes[bytes.length - byte_index - 1] >> bit_shift) & 0b11
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
        // output_digital_pins = []
        input_pins = []
        output_digital_pins = []
        output_analog_pins = []

        characteristic_configuration_pins = null
        characteristic_configuration_connection_parameters = null
        characteristic_output = null
        characteristic_input = null
        characteristic_gpio_asm_data = null

        is_device_connected = false
        gatt_server = null

        last_current_sequence = null

        display_outputs_digital()
        display_outputs_analog()
        display_inputs_digital()
        display_pin_configuration_menu()
        display_device_information()
        display_digital_sequence_steps()
        display_connection_params_configuration()

        set_digital_outputs_text('Device not connected')
        set_digital_inputs_text('Device not connected')
        set_output_buttons_enabled(false)

        set_device_name('-')
        set_device_firmware_version('-')
        set_device_battery_level('-')

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

        output_digital_pins = []

        for (var i = 0; i < output_count; i++) {
            output_digital_pins.push({
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
                output_digital_pins[decoded.index].is_high = decoded.is_high
            }
        }

        set_output_buttons_enabled(true)
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
    }

    async function handle_output_analog_characteristic(characteristic) {
        const analog_pin = {
            output_analog_characteristic: characteristic
        }
        if (characteristic.properties.read) {
            const response = await characteristic.readValue()
            if (response.byteLength == 2) {
                analog_pin.value = response.getUint16(0, true)
            }
        }
        output_analog_pins.push(analog_pin)
    }

    async function handle_analog_characteristic(characteristic) {
        const is_output = characteristic.properties.write
        if (is_output) {
            await handle_output_analog_characteristic(characteristic)
        }
    }

    async function handle_digital_characteristic(characteristic) {
        const is_output = (characteristic.uuid == '00002a57-0000-1000-8000-00805f9b34fb') || characteristic.properties.write
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

    function handle_gpio_asm_characteristic(characteristic) {
        characteristic_gpio_asm_data = characteristic
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

    async function handle_device_information_service(service) {
        const characteristics = await service.getCharacteristics()
        for (const characteristic of characteristics) {
            const uuid = characteristic.uuid
            if (uuid == '00002a26-0000-1000-8000-00805f9b34fb') {
                const value = await characteristic.readValue()
                device_firmware_version = new TextDecoder().decode(new Uint8Array(value.buffer))
                set_device_firmware_version(device_firmware_version)
            }
        }
    }

    async function handle_automation_io_service(service) {
        var characteristics = null
        try {
            characteristics = await service.getCharacteristics()
        } catch (e) {
            console.error('error getting AIO characteristics. Probably no pins configured. ' + e)
            return
        }
        for (const characteristic of characteristics) {
            const uuid = characteristic.uuid
            if (['00002a56-0000-1000-8000-00805f9b34fb','00002a57-0000-1000-8000-00805f9b34fb'].includes(uuid)) {
                await handle_digital_characteristic(characteristic)
            } else if (uuid == '00002a58-0000-1000-8000-00805f9b34fb') {
                await handle_analog_characteristic(characteristic)
            } else if (uuid == '9c100056-5cf1-8fa7-1549-01fdc1d171dc') {
                handle_gpio_asm_characteristic(characteristic)
            }
        }
    }

    async function handle_configuration_service(service) {
        const characteristics = await service.getCharacteristics()
        for (const characteristic of characteristics) {
            const uuid = characteristic.uuid
            if (uuid == '9c100001-5cf1-8fa7-1549-01fdc1d171dc') {
                await handle_pin_configuration_characteristic(characteristic)
            } else if (uuid == '9c100002-5cf1-8fa7-1549-01fdc1d171dc') {
                await handle_connection_params_characteristic(characteristic)
            }
        }
    }

    async function handle_gpio_asm_service(service) {
        const characteristics = await service.getCharacteristics()

        for (const characteristic of characteristics) {
            const uuid = characteristic.uuid
            if (uuid == 'b1190001-2a74-d5a2-784f-c1cdb3862ab0') {
                characteristic_gpio_asm_data = characteristic
            }
        }
    }

    async function handle_battery_level_characteristic(characteristic) {
        const data = await characteristic.readValue()
        const level = data.getUint8()
        set_device_battery_level(level)
    }

    async function handle_battery_service(service) {
        const characteristics = await service.getCharacteristics()

        for (const characteristic of characteristics) {
            const uuid = characteristic.uuid
            if (uuid == '00002a19-0000-1000-8000-00805f9b34fb') {
                await handle_battery_level_characteristic(characteristic)
            }
        }
    }

    function check_firmware_version() {
        if (device_firmware_version == undefined) {
            alert('Could not read chip firmware version.\n\nContinue at your own risk as the chip might not be compatible.')
            return
        }

	    const expected = '0.9.'

        if (device_firmware_version.startsWith(expected)) {
            return
        }

        alert(`Device firmware version: ${device_firmware_version}.\nSupported firmwares are ${expected}x .\n\nContinue at your own risk or update your firmware.`)
    }

    async function on_bluetooth_gatt_connected(gatt) {
        is_device_connected = gatt.connected
        gatt_server = gatt
        display_device_information()

        set_device_name(gatt.device.name)

        var services = await gatt.getPrimaryServices()

        const service_handler_map = {
            '0000180a-0000-1000-8000-00805f9b34fb': handle_device_information_service,
            '0000180f-0000-1000-8000-00805f9b34fb': handle_battery_service,
            '00001815-0000-1000-8000-00805f9b34fb': handle_automation_io_service,
            '9c100000-5cf1-8fa7-1549-01fdc1d171dc': handle_configuration_service,
            'b1190000-2a74-d5a2-784f-c1cdb3862ab0': handle_gpio_asm_service,
        }

        for (const service of services) {
            const handler = service_handler_map[service.uuid]
            if (handler == undefined) {
                continue
            }
            await handler(service)
        }

        const input_pin_count = input_pins.length
        if (input_pin_count == 0) {
            set_digital_inputs_text('No digital inputs configured')
        } else {
            set_digital_inputs_text('')
            $('#gpio-asm-digital-input-count').val(input_pin_count)
        }

        const output_pin_count = output_digital_pins.length
        if (output_pin_count == 0) {
            set_digital_outputs_text('No digital outputs configured')
        } else {
            set_digital_outputs_text('')
            $('#gpio-asm-digital-output-count').val(output_pin_count)
        }

        (function(){
            if(localStorage == undefined){
                console.error('localStorage not availbale')
                return
            }
            const key = `sequence_${gatt.device.name}`
            const value = localStorage.getItem(key)
            if(value == undefined){
                return
            }
            sequence_digital_steps = JSON.parse(value)
        })()


        for (const step of sequence_digital_steps) {
            if (step.states.length > output_pin_count) {
                step.states.splice(output_pin_count)
            } else {
                while (step.states.length < output_pin_count) {
                    step.states.push(false)
                }
            }
        }

        check_firmware_version()

        match_output_pins_to_configuration()
        match_input_pins_to_configuration()

        display_digital_sequence_steps()
        display_connection_params_configuration()

        display_pin_configuration_menu(configured_pins)
        display_outputs_digital()
        display_outputs_analog()
        display_inputs_digital()
        display_device_information()
    }

    function match_input_pins_to_configuration() {
        if (input_pins.length == 0) {
            return
        }
        if (configured_pins.length == 0) {
            return
        }

        let configured_input_pin_count = 0

        for(const configured_pin of configured_pins) {
            if (configured_pin.function == 'input') {
                configured_input_pin_count++
            }
        }

        const preconfigured_pin_count = input_pins.length - configured_input_pin_count

        var input_pin_index = 0
        for (const configured_pin of configured_pins) {
            if (input_pin_index > input_pins.length) {
                console.error('Pin matching overflow')
                return
            }
            if (configured_pin.function == 'input') {
                input_pins[input_pin_index + preconfigured_pin_count].pin = configured_pin.pin
                input_pin_index++
            }
        }
    }

    function match_output_pins_to_configuration() {
        if (output_digital_pins.length == 0 && output_analog_pins.length == 0) {
            return
        }
        if (configured_pins.length == 0) {
            return
        }

        var output_digital_pin_index = 0
        var output_analog_pin_index = 0

        let configured_output_digital_pin_count = 0

        for(const configured_pin of configured_pins) {
            if (configured_pin.function == 'output') {
                if (configured_pin.function_output == 'digital') {
                    configured_output_digital_pin_count++
                }
            }
        }

        const preconfigured_pin_count = output_digital_pins.length - configured_output_digital_pin_count

        for (const configured_pin of configured_pins) {
            if (configured_pin.function == 'output') {
                if (configured_pin.function_output == 'digital') {
                    if (output_digital_pin_index > output_digital_pins.length) {
                        console.error('Pin matching overflow')
                        continue
                    }
                    output_digital_pins[output_digital_pin_index + preconfigured_pin_count].pin = configured_pin.pin
                    output_digital_pin_index++
                    continue
                }
                if (configured_pin.function_output == 'analog') {
                    if (output_analog_pin_index > output_analog_pins.length) {
                        console.error('Pin matching overflow')
                        continue
                    }
                    output_analog_pins[output_analog_pin_index].pin = configured_pin.pin
                    output_analog_pin_index++
                    continue
                }
            }
        }
    }

    async function handle_pin_configuration_characteristic(characteristic) {
        set_device_status('reading configuration...')
        if (configured_pins.length > 0) {
            console.log('pin configuratioin already known, reading anyways')
            // return;
        }
        characteristic_configuration_pins = characteristic
        const value = await characteristic.readValue()

        const bytes = new Uint8Array(value.buffer)

        const pin_count = bytes.length * 2

        configured_pins = []

        for (var i = 0; i < bytes.length; i++) {
            const byte = bytes[i]

            configured_pins.push(decode_pin_bits(pin_count - ((i * 2) + 0) - 1, (byte >> 4) & 0b1111))
            configured_pins.push(decode_pin_bits(pin_count - ((i * 2) + 1) - 1, (byte >> 0) & 0b1111))
        }

        configured_pins = configured_pins.reverse()

        set_device_status('read configuration.')
    }

    async function handle_connection_params_characteristic(characteristic) {
        characteristic_configuration_connection_parameters = characteristic
        const result = await characteristic_configuration_connection_parameters.readValue()

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

    return {
        init: init
    }
})()


$(document).ready(module.init)
