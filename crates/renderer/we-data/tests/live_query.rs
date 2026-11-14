//! `model_subscribe` / `dispose_query` against `FakeExecutor`: a live query
//! opens with `modelSubscribe`'s three fields — `subscriptionId`, initial
//! `result`, `revision` — and closes through `disposeQuery`'s handle.
use std::future::Future;
use std::pin::pin;
use std::task::{Context, Poll, RawWaker, RawWakerVTable, Waker};

use we_data::{ClassSel, Executor, FakeExecutor, LiveQuery, LiveQueryId, QueryIr, SpaceId};
use we_expr::Value;

/// Drive an always-ready future. we-data builds without tokio (wasm), so the
/// test harness is a noop waker — the fake's futures never actually pend.
fn block_on<F: Future>(future: F) -> F::Output {
    fn noop(_: *const ()) {}
    fn clone(_: *const ()) -> RawWaker {
        RawWaker::new(std::ptr::null(), &VTABLE)
    }
    static VTABLE: RawWakerVTable = RawWakerVTable::new(clone, noop, noop, noop);
    let waker = unsafe { Waker::from_raw(RawWaker::new(std::ptr::null(), &VTABLE)) };
    let mut context = Context::from_waker(&waker);
    let mut future = pin!(future);
    loop {
        match future.as_mut().poll(&mut context) {
            Poll::Ready(output) => return output,
            Poll::Pending => std::thread::yield_now(),
        }
    }
}

#[test]
fn model_subscribe_carries_the_subscribed_reply() {
    let executor = FakeExecutor::new();
    let space = SpaceId::from("space://main");

    let live =
        block_on(executor.model_subscribe(&space, ClassSel::one("Task"), &QueryIr::default()))
            .unwrap();
    // PerspectiveSubscribed: subscriptionId + initial result + revision.
    assert_eq!(live.id().as_str(), "fake-0");
    assert_eq!(live.revision(), 0);
    assert!(matches!(live.result(), Value::List(rows) if rows.is_empty()));

    // A second subscription gets its own id.
    let other =
        block_on(executor.model_subscribe(&space, ClassSel::one("Task"), &QueryIr::default()))
            .unwrap();
    assert_ne!(live.id(), other.id());
    assert_eq!(other.id().as_str(), "fake-1");
}

#[test]
fn record_lands_a_newer_revision() {
    let mut live = LiveQuery::new(LiveQueryId::new("sub-9"), Value::Null, 0);
    live.record(Value::from(1.5), 3);
    assert_eq!(live.revision(), 3);
    assert!(live.result().strict_eq(&1.5.into()));
}

#[test]
fn dispose_ends_the_subscription_through_the_executor() {
    let executor = FakeExecutor::new();
    let space = SpaceId::from("space://main");

    let live =
        block_on(executor.model_subscribe(&space, ClassSel::one("Task"), &QueryIr::default()))
            .unwrap();
    let id = live.id().clone();
    assert!(executor.disposed().is_empty());

    // dispose consumes the handle — the id is what disposeQuery sends back.
    let done = block_on(live.dispose(&space, &executor)).unwrap();
    assert!(done);
    assert_eq!(executor.disposed(), vec![id]);
}
