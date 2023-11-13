import { encode_varint, encode_analog_values, encode_pin_bytes_length, encode_states } from "./encoders.js"

function check_instruction_argument_length(instruction, expected_argument_count, actual_argument_count) {
    if (actual_argument_count < expected_argument_count) {
        throw `too few arguments for ${instruction}`
    }
    if (actual_argument_count > expected_argument_count) {
        throw `too many arguments for ${instruction}`
    }
}

export function gpio_asm_compile(instructions) {
    var current_offset = 0

    var labels = {}

    const bytecode_version = 0

    instructions.splice(0, 0, {
        instruction: 'check_bytecode_version',
        args: [
            bytecode_version
        ]
    })

    for (const instruction of instructions) {
        if (instruction.instruction == 'label') {
            labels[instruction.args[0]] = current_offset
            continue
        }
        instruction.offset = current_offset
        if (instruction.instruction.startsWith('jump')) {
            current_offset += 2
            instruction.compiled_length = 2

            if (instruction.instruction == 'jump_count') {
                check_instruction_argument_length('jump_count', 2, instruction.args.length)

                const length_count = encode_varint(Number(instruction.args[1])).length
                current_offset += length_count
                instruction.compiled_length += length_count
            } else if (instruction.instruction.startsWith('jump_match_')) {
                check_instruction_argument_length(instruction.instruction, 2, instruction.args.length)

                const encoder = gpio_asm_create_pin_encoder()

                const length_count = encoder(instruction.args[1]).length
                current_offset += length_count
                instruction.compiled_length += length_count
            } else {
                check_instruction_argument_length('jump', 1, instruction.args.length)
            }

            continue
        }
        var bytes = gpio_asm_compile_command(instruction)
        current_offset += bytes.length
        instruction.bytes = bytes
    }

    for (const instruction of instructions) {
        if (!instruction.instruction.startsWith('jump')) {
            continue
        }
        const target = instruction.args[0]
        const address = labels[target]
        if (address == undefined) {
            throw `label ${target} unknown`
        }

        instruction.target_address = address

        const args = [address]

        if (instruction.instruction == 'jump_count') {
            args.push(Number(instruction.args[1]))
        } else if (instruction.instruction.startsWith('jump_match_')) {
            args.push(instruction.args[1])
        }

        const bytes = gpio_asm_compile_command({
            instruction: instruction.instruction,
            args: args
        })
        instruction.bytes = bytes
    }

    while (true) {
        // find first jump instruction with target address size wider than expected
        const jump_mismatch_index = instructions.findIndex(instruction =>
            instruction.instruction.startsWith('jump') &&
            instruction.compiled_length != instruction.bytes.length
        )
        if (jump_mismatch_index == -1) {
            // no mismatch found
            break
        }
        if (jump_mismatch_index == instructions.length) {
            // no instructions shifted since this is the last instruction
            return
        }
        console.log(`resolving conflict with instruction ${jump_mismatch_index}`)

        const jump_mismatch = instructions[jump_mismatch_index]
        // calculate difference between expected and real address width
        const length_dif = jump_mismatch.bytes.length - jump_mismatch.compiled_length

        // calculate start off region that is getting shifted
        const affected_address_start = instructions[jump_mismatch_index + 1].offset

        // shift every following instructions offset by length dif
        for (var i = (jump_mismatch_index + 1); i < instructions.length; i++) {
            if (instructions[i].instruction == 'label') {
                continue
            }
            instructions[i].offset += length_dif
        }

        // adjust target addresses of all jump instruction
        // that jump into the affected region
        for (const instruction of instructions) {
            if (!instruction.instruction.startsWith('jump')) {
                continue
            }
            var address = instruction.target_address
            if (address < affected_address_start) {
                continue
            }
            address += length_dif
            instruction.target_address = address

            const args = [address]
            if (instruction.instruction == 'jump_count') {
                args.push(Number(instruction.args[1]))
            }

            const bytes = gpio_asm_compile_command({
                instruction: instruction.instruction,
                args: args
            })
            instruction.bytes = bytes
            instruction.compiled_length = bytes.length
        }
    }

    const data = []

    for (const instruction of instructions) {
        if (instruction.instruction == 'label') {
            continue
        }

        data.push(...instruction.bytes)
    }

    return data
}


function create_gpio_asm_file_load_handler(compiled_data_handler) {
    return function (event) {
        try {
            const file_contents = event.currentTarget.result
            const lines = file_contents.split('\n')
            const commands = []
            for (var line of lines) {
                line = line.trim()
                if (line == '') {
                    continue
                }
                var command = line.match(/^[^ ]+ */)
                command = command[0]
                const argument_start = command.length
                var command = command.trim()

                var args = line.substring(argument_start)
                args = args.trim()

                if (args == '') {
                    args = []
                } else {
                    args = args.split(' ')
                }

                commands.push({
                    instruction: command,
                    args: args
                })
            }

            const data = gpio_asm_compile(commands)

            console.log(data)
            compiled_data_handler(data)
        } catch (e) {
            set_gpio_asm_message(e)
        }
    }
}

export function gpio_asm_file_read(compiled_data_handler) {
    const files = $('#gpio-asm-file-upload')[0].files
    if (files.length == 0) {
        throw 'no file uploaded'
    }
    const file = files[0]
    if (!file.name.endsWith('.gpioasm')) {
        throw 'filename must end with .gpioasm'
    }

    const reader = new FileReader()
    reader.onload = create_gpio_asm_file_load_handler(compiled_data_handler)
    reader.readAsText(file)
}

export function set_gpio_asm_message(message) {
    $('#gpio-asm-file-info').text(message)
}

function gpio_asm_create_pin_encoder() {
    return function (states_string) {
        return encode_states(Array.from(states_string))
    }
}

function gpio_asm_encode_uint_16(int_string) {
    const value = Number(int_string)
    const array = new Uint16Array(1)
    array[0] = value
    return new Uint8Array(array.buffer)
}

function gpio_asm_compile_command(command) {
    const gpio_asm_encode_input_pins = gpio_asm_create_pin_encoder()
    const gpio_asm_encode_output_pins = gpio_asm_create_pin_encoder()



    const gpio_asm_instrutions = {
        write_digital: {
            opcode_encoder: encode_pin_bytes_length,
            instruction_bits: 0b00000000,
            argument_encoders: [
                gpio_asm_encode_output_pins
            ]
        },
        write_analog_channel_0: {
            instruction_bits: 0b00010000,
            argument_encoders: [
                gpio_asm_encode_uint_16
            ]
        },
        write_analog_channel_1: {
            instruction_bits: 0b00010001,
            argument_encoders: [
                gpio_asm_encode_uint_16
            ]
        },
        write_analog_channel_2: {
            instruction_bits: 0b00010010,
            argument_encoders: [
                gpio_asm_encode_uint_16
            ]
        },
        write_analog_channel_3: {
            instruction_bits: 0b00010011,
            argument_encoders: [
                gpio_asm_encode_uint_16
            ]
        },
        sleep_ms: {
            instruction_bits: 0b00100000,
            argument_encoders: [
                encode_varint
            ]
        },
        sleep_match_all: {
            opcode_encoder: encode_pin_bytes_length,
            instruction_bits: 0b00110000,
            argument_encoders: [
                gpio_asm_encode_input_pins
            ]
        },
        sleep_match_any: {
            opcode_encoder: encode_pin_bytes_length,
            instruction_bits: 0b01000000,
            argument_encoders: [
                gpio_asm_encode_input_pins
            ]
        },
        sleep_match_all_timeout: {
            opcode_encoder: encode_pin_bytes_length,
            instruction_bits: 0b01010000,
            argument_encoders: [
                gpio_asm_encode_input_pins,
                encode_varint
            ]
        },
        sleep_match_any_timeout: {
            opcode_encoder: encode_pin_bytes_length,
            instruction_bits: 0b01100000,
            argument_encoders: [
                gpio_asm_encode_input_pins,
                encode_varint
            ]
        },
        jump: {
            instruction_bits: 0b01110000,
            argument_encoders: [
                encode_varint
            ]
        },
        check_bytecode_version: {
            instruction_bits: 0b10000000,
            argument_encoders: [
                encode_varint
            ]
        },
        jump_match_all: {
            opcode_encoder: encode_pin_bytes_length,
            instruction_bits: 0b10010000,
            argument_encoders: [
                encode_varint,
                gpio_asm_encode_input_pins
            ]
        },
        jump_match_any: {
            opcode_encoder: encode_pin_bytes_length,
            instruction_bits: 0b10100000,
            argument_encoders: [
                encode_varint,
                gpio_asm_encode_input_pins
            ]
        },
        jump_count: {
            instruction_bits: 0b10110000,
            argument_encoders: [
                encode_varint,
                encode_varint,
            ]
        },
        exit: {
            instruction_bits: 0b11000000,
            argument_encoders: []
        }
    }

    const instruction = command.instruction

    if (instruction == 'label') {
        // will take care of this later
        return []
    }

    const instruction_info = gpio_asm_instrutions[instruction]

    if (instruction_info == undefined) {
        throw `instruction ${instruction} unknown`
    }

    const bytes = []

    const opcode = function () {
        if (instruction_info.opcode_encoder == undefined) {
            return instruction_info.instruction_bits
        }
        return instruction_info.opcode_encoder(command, instruction_info.instruction_bits)
    }()

    bytes.push(opcode)

    check_instruction_argument_length(command.instruction, instruction_info.argument_encoders.length, command.args.length)

    for (var i = 0; i < command.args.length; i++) {
        bytes.push(
            ...instruction_info.argument_encoders[i](command.args[i])
        )
    }

    return bytes
}
