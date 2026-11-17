//! Terminal setup and its undo. Raw mode and the alternate screen are
//! process-wide terminal state: if anything after raw mode fails — the
//! alternate screen, `Terminal::new`, the event loop — the shell must get
//! its terminal back. [`init`] hands out a [`TermGuard`] whose `Drop`
//! restores whatever was done, including on a panic.
use std::io;

/// The terminal operations setup and restore use — crossterm in the
/// binary ([`Crossterm`]), a recorder in the tests.
pub trait TermOps {
    fn enable_raw(&mut self) -> io::Result<()>;
    fn disable_raw(&mut self) -> io::Result<()>;
    fn enter_alt(&mut self) -> io::Result<()>;
    fn leave_alt(&mut self) -> io::Result<()>;
    fn show_cursor(&mut self) -> io::Result<()>;
}

/// Undoes, on drop, whatever setup reached: leaves the alternate screen,
/// disables raw mode, shows the cursor. Restore errors are ignored — there
/// is nothing left to report them to.
pub struct TermGuard<T: TermOps> {
    ops: T,
    raw: bool,
    alt: bool,
}

impl<T: TermOps> Drop for TermGuard<T> {
    fn drop(&mut self) {
        if self.alt {
            let _ = self.ops.leave_alt();
        }
        if self.raw {
            let _ = self.ops.disable_raw();
            let _ = self.ops.show_cursor();
        }
    }
}

/// Raw mode, then the alternate screen. The guard exists the moment raw
/// mode is on, so a failing alternate screen — or a panic anywhere after —
/// drops it and restores the terminal.
pub fn init<T: TermOps>(mut ops: T) -> io::Result<TermGuard<T>> {
    ops.enable_raw()?;
    let mut guard = TermGuard {
        ops,
        raw: true,
        alt: false,
    };
    // Counted before the call: a write that fails half-way may already
    // have switched screens, and leaving one never entered is harmless.
    guard.alt = true;
    guard.ops.enter_alt()?;
    Ok(guard)
}

/// The real terminal, on stdout.
pub struct Crossterm;

impl TermOps for Crossterm {
    fn enable_raw(&mut self) -> io::Result<()> {
        crossterm::terminal::enable_raw_mode()
    }
    fn disable_raw(&mut self) -> io::Result<()> {
        crossterm::terminal::disable_raw_mode()
    }
    fn enter_alt(&mut self) -> io::Result<()> {
        crossterm::execute!(io::stdout(), crossterm::terminal::EnterAlternateScreen)
    }
    fn leave_alt(&mut self) -> io::Result<()> {
        crossterm::execute!(io::stdout(), crossterm::terminal::LeaveAlternateScreen)
    }
    fn show_cursor(&mut self) -> io::Result<()> {
        crossterm::execute!(io::stdout(), crossterm::cursor::Show)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::rc::Rc;

    /// Records each call; `fail` names the one step that errors.
    struct Recorder {
        log: Rc<RefCell<Vec<&'static str>>>,
        fail: Option<&'static str>,
    }

    impl Recorder {
        fn new(fail: Option<&'static str>) -> (Self, Rc<RefCell<Vec<&'static str>>>) {
            let log = Rc::new(RefCell::new(Vec::new()));
            (
                Recorder {
                    log: log.clone(),
                    fail,
                },
                log,
            )
        }
        fn step(&mut self, name: &'static str) -> io::Result<()> {
            self.log.borrow_mut().push(name);
            if self.fail == Some(name) {
                Err(io::Error::other(name))
            } else {
                Ok(())
            }
        }
    }

    impl TermOps for Recorder {
        fn enable_raw(&mut self) -> io::Result<()> {
            self.step("enable_raw")
        }
        fn disable_raw(&mut self) -> io::Result<()> {
            self.step("disable_raw")
        }
        fn enter_alt(&mut self) -> io::Result<()> {
            self.step("enter_alt")
        }
        fn leave_alt(&mut self) -> io::Result<()> {
            self.step("leave_alt")
        }
        fn show_cursor(&mut self) -> io::Result<()> {
            self.step("show_cursor")
        }
    }

    #[test]
    fn a_failed_alternate_screen_still_restores_raw_mode() {
        let (ops, log) = Recorder::new(Some("enter_alt"));
        assert!(init(ops).is_err());
        let log = log.borrow();
        assert!(log.contains(&"disable_raw"), "raw mode undone: {log:?}");
        assert!(log.contains(&"show_cursor"), "cursor shown: {log:?}");
    }

    #[test]
    fn a_panic_after_init_restores_everything() {
        // `Terminal::new` (or anything after setup) panicking.
        let (ops, log) = Recorder::new(None);
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = init(ops).expect("init");
            panic!("Terminal::new failed");
        }));
        assert!(r.is_err());
        assert_eq!(
            *log.borrow(),
            [
                "enable_raw",
                "enter_alt",
                "leave_alt",
                "disable_raw",
                "show_cursor"
            ]
        );
    }

    #[test]
    fn a_failed_raw_mode_restores_nothing() {
        let (ops, log) = Recorder::new(Some("enable_raw"));
        assert!(init(ops).is_err());
        assert_eq!(*log.borrow(), ["enable_raw"]);
    }
}
