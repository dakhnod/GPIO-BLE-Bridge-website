
export function encode_analog_values(analog_values) {
    analog_values = analog_values.map(value => (value == undefined) ? 0xffff : value)
    const array = new Uint16Array(analog_values)
    return new Uint8Array(array.buffer)
}

export function encode_varint(number) {
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

export function encode_pin(pin) {
    var byte = 0b1111

    if (pin == undefined) {
        return byte;
    }

    if (pin.function == 'output') {
        byte = 0b0000
        if (pin.function_output == 'analog') {
            byte |= 0b0100
        } else if (pin.default_high) {
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

export function encode_two_pins(pin0, pin1) {
    return (encode_pin(pin0) << 0) | (encode_pin(pin1) << 4);
}

export function encode_pin_configuration(configured_pins) {
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

export function encode_pin_bytes_length(command, opcode_original) {
    function get_bytes_count_needed_for_bits(state_string) {
        return Math.ceil(state_string.length / 4)
    }

    const instruction = command.instruction
    if (instruction == 'write_digital') {
        return (opcode_original | get_bytes_count_needed_for_bits(command.args[0]))
    }
    if (instruction.startsWith('sleep_match')) {
        return (opcode_original | get_bytes_count_needed_for_bits(command.args[0]))
    }
    if (instruction.startsWith('jump_match')) {
        return (opcode_original | get_bytes_count_needed_for_bits(command.args[1]))
    }
}



export function filter_states(states) {
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

export function encode_states(states) {
    const bytes_needed = Math.ceil(states.length / 4)
    const bytes = Array(bytes_needed).fill(0xff)
    for (var i = 0; i < states.length; i++) {
        const state = states[i]
        if (state == undefined) {
            continue
        }

        const byte_index = Math.floor(i / 4)
        const bit_shift = ((i * 2) % 8)

        if (state) {
            bytes[byte_index] &= ~(0b10 << bit_shift)
        } else {
            bytes[byte_index] &= ~(0b11 << bit_shift)
        }
    }

    return bytes.reverse()
}
