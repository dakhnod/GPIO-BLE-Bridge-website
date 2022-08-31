const module = (function(){
    function init(){
        $('#button_bluetooth_connect').click(on_bluetooth_button_connect_click)
    }

    function on_bluetooth_button_connect_click(){
        navigator.bluetooth.requestDevice({
            /*filters: [
                {
                    services: [0x1815]
                }
            ],*/
            acceptAllDevices: true,
            optionalServices: [
                '00001815-0000-1000-8000-00805f9b34fb',
                '9c100001-5cf1-8fa7-1549-01fdc1d171dc'            
            ]
        }).then(on_bluetooth_device_selected)
    }

    function on_bluetooth_device_selected(device){
        console.log(device)
        set_device_name(device.name)
        set_device_status('connecting...')

        device.gatt.connect()
            .then(on_bluetooth_gatt_connected)
            .catch(on_bluetooth_gatt_connect_except)
    }

    function on_bluetooth_gatt_connect_except(error){
        console.log(error)
        set_device_status(`connection failed: ${error}`)
    }

    async function on_bluetooth_gatt_connected(gatt){
        if(gatt.connected){
            set_device_status('connected')
        }else{
            set_device_status('not connected')
        }
        console.log(gatt)

        var service = null

        try{
            console.log('fetching primary service...')
            service = await gatt.getPrimaryService('00001815-0000-1000-8000-00805f9b34fb')
            console.log('fetched primary service.')
            console.log(service)
        }catch(e){
            console.error(e)
            set_device_status('Automation IO Service not found')
            await gatt.disconnect()
            return
        }

        const characteristics = await service.getCharacteristics()
        console.log(characteristics)

        for(const characteristic of characteristics){
            const uuid = characteristic.uuid
            if(uuid == '9c100001-5cf1-8fa7-1549-01fdc1d171dc'){
                console.log('found config service')
                await handle_pin_configuration_characteristic(characteristic)
            }
        }
    }

    async function handle_pin_configuration_characteristic(characteristic){
        set_device_status('reading configuration...')
        const value = await characteristic.readValue()
        const bytes = new Uint8Array(value)
        console.log(bytes)
    }

    function set_device_status(status){
        $('#info_device_status').text(`Device status: ${status}`)
    }

    function set_device_name(name){
        $('#info_device_name').text(`Device name: ${name}`)
    }

    return {
        init: init
    }
})()


$(document).ready(module.init)