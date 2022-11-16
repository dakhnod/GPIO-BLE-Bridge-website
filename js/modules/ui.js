

export function set_device_status(status) {
    $('#info-device-status').text(`Device status: ${status}`)
}

export function set_device_name(name) {
    $('#info-device-name').text(`Device name: ${name}`)
}

export function set_device_battery_level(level) {
    $('#info-device-battery-level').text(`Device battery level: ${level}%`)
}

export function set_device_firmware_version(version) {
    $('#info-device-firmware-version').text(`Device firmware version: ${version}`)
}