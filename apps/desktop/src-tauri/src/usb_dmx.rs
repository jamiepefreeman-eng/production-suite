//! Enttec USB interfaces over a serial port.
//!
//! * DMX USB Pro: framed messages, the widget does the timing. Recommended.
//! * Open DMX USB: we bit-bang BREAK / MAB and the frame ourselves. Works,
//!   but desktop scheduling causes occasional flicker. On macOS the FTDI VCP
//!   driver must expose it as /dev/cu.usbserial-XXXX.

#[cfg(not(feature = "usb-dmx"))]
use suite_core::dmx::DmxSink;

#[cfg(feature = "usb-dmx")]
mod imp {
    use serialport::{DataBits, Parity, SerialPort, StopBits};
    use std::io::{self, Write};
    use std::time::Duration;
    use suite_core::dmx::{enttec, DmxSink};

    pub struct EnttecPro {
        port: Box<dyn SerialPort>,
        name: String,
    }

    impl DmxSink for EnttecPro {
        fn name(&self) -> String {
            format!("Enttec Pro {}", self.name)
        }
        fn send(&mut self, _u: u16, data: &[u8]) -> io::Result<()> {
            self.port.write_all(&enttec::pro_dmx_frame(data))
        }
    }

    pub struct OpenDmx {
        port: Box<dyn SerialPort>,
        name: String,
    }

    impl DmxSink for OpenDmx {
        fn name(&self) -> String {
            format!("Open DMX {}", self.name)
        }
        fn send(&mut self, _u: u16, data: &[u8]) -> io::Result<()> {
            let e = |e: serialport::Error| io::Error::other(e);
            self.port.set_break().map_err(e)?;
            spin(Duration::from_micros(enttec::OPEN_DMX_BREAK_US));
            self.port.clear_break().map_err(e)?;
            spin(Duration::from_micros(enttec::OPEN_DMX_MAB_US));
            self.port.write_all(&enttec::open_dmx_payload(data))?;
            self.port.flush()
        }
    }

    /// Sub-millisecond waits: thread::sleep is far too coarse for DMX break timing.
    fn spin(d: Duration) {
        let t = std::time::Instant::now();
        while t.elapsed() < d {
            std::hint::spin_loop();
        }
    }

    pub fn open_pro(port: &str) -> Result<Box<dyn DmxSink>, String> {
        let p = serialport::new(port, 57_600)
            .timeout(Duration::from_millis(50))
            .open()
            .map_err(|e| e.to_string())?;
        Ok(Box::new(EnttecPro { port: p, name: port.into() }))
    }

    pub fn open_open_dmx(port: &str) -> Result<Box<dyn DmxSink>, String> {
        let p = serialport::new(port, enttec::OPEN_DMX_BAUD)
            .data_bits(DataBits::Eight)
            .stop_bits(StopBits::Two)
            .parity(Parity::None)
            .timeout(Duration::from_millis(50))
            .open()
            .map_err(|e| e.to_string())?;
        Ok(Box::new(OpenDmx { port: p, name: port.into() }))
    }

    pub fn list() -> Vec<super::SerialPortInfo> {
        serialport::available_ports()
            .unwrap_or_default()
            .into_iter()
            .map(|p| {
                let (vid, pid, product, serial) = match &p.port_type {
                    serialport::SerialPortType::UsbPort(u) => {
                        (Some(u.vid), Some(u.pid), u.product.clone(), u.serial_number.clone())
                    }
                    _ => (None, None, None, None),
                };
                // FTDI (0403:6001) is what both Enttec Pro and Open DMX enumerate as.
                let likely_dmx = vid == Some(0x0403);
                super::SerialPortInfo { name: p.port_name, vid, pid, product, serial, likely_dmx }
            })
            .collect()
    }
}

#[derive(serde::Serialize, Clone)]
pub struct SerialPortInfo {
    pub name: String,
    pub vid: Option<u16>,
    pub pid: Option<u16>,
    pub product: Option<String>,
    pub serial: Option<String>,
    pub likely_dmx: bool,
}

#[cfg(feature = "usb-dmx")]
pub use imp::{list as list_ports, open_open_dmx, open_pro};

#[cfg(not(feature = "usb-dmx"))]
pub fn open_pro(_: &str) -> Result<Box<dyn DmxSink>, String> {
    Err("built without the usb-dmx feature".into())
}
#[cfg(not(feature = "usb-dmx"))]
pub fn open_open_dmx(_: &str) -> Result<Box<dyn DmxSink>, String> {
    Err("built without the usb-dmx feature".into())
}
#[cfg(not(feature = "usb-dmx"))]
pub fn list_ports() -> Vec<SerialPortInfo> {
    vec![]
}
