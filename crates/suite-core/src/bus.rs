//! A tiny in-process publish/subscribe bus.
//!
//! Every module subscribes and gets its own receiver; dead subscribers are
//! dropped automatically on the next publish.

use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct Bus<T: Clone + Send + 'static> {
    subscribers: Arc<Mutex<Vec<Sender<T>>>>,
}

impl<T: Clone + Send + 'static> Default for Bus<T> {
    fn default() -> Self {
        Self { subscribers: Arc::new(Mutex::new(Vec::new())) }
    }
}

impl<T: Clone + Send + 'static> Bus<T> {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn subscribe(&self) -> Receiver<T> {
        let (tx, rx) = channel();
        self.subscribers.lock().unwrap().push(tx);
        rx
    }

    pub fn publish(&self, msg: T) {
        let mut subs = self.subscribers.lock().unwrap();
        subs.retain(|s| s.send(msg.clone()).is_ok());
    }

    pub fn publish_all(&self, msgs: impl IntoIterator<Item = T>) {
        for m in msgs {
            self.publish(m);
        }
    }

    pub fn subscriber_count(&self) -> usize {
        self.subscribers.lock().unwrap().len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fan_out_and_drop_dead() {
        let bus: Bus<u32> = Bus::new();
        let a = bus.subscribe();
        let b = bus.subscribe();
        bus.publish(7);
        assert_eq!(a.recv().unwrap(), 7);
        assert_eq!(b.recv().unwrap(), 7);
        drop(b);
        bus.publish(8);
        assert_eq!(bus.subscriber_count(), 1);
        assert_eq!(a.recv().unwrap(), 8);
    }
}
