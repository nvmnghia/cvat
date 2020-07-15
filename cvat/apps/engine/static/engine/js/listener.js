/* eslint-disable eqeqeq */
/*
 * Copyright (C) 2018 Intel Corporation
 *
 * SPDX-License-Identifier: MIT
 */

/* exported Listener */

'use strict';

/**
 * Why is this class called Listeners?
 * In notify(), the listener seems to notify() other object.
 * Let's dig.
 */
class Listener {
    /**
     * Listener (subscriber) interface, doubles as publisher.
     *
     * @param {*} notifyCallbackName Name of a function that all subscribers
     *                               have to implement. When notify() is called,
     *                               subscribers are notified by calling their
     *                               implementations of notifyCallbackName.
     * @param {*} getStateCallback   Get state. The state returned will be
     *                               passed to the subscribers.
     */
    constructor(notifyCallbackName, getStateCallback) {
        this._listeners = [];
        this._notifyCallbackName = notifyCallbackName;
        this._getStateCallback = getStateCallback;
    }

    subscribe(listener) {
        if (typeof (listener) !== 'object') {
            throw Error('Bad listener for subscribe found. Listener is not object.');
        }

        if (typeof (listener[this._notifyCallbackName]) !== 'function') {
            throw Error(`Bad listener for subscribe found. Listener does not have a callback function ${this._notifyCallbackName}`);
        }

        if (this._listeners.indexOf(listener) === -1) {
            this._listeners.push(listener);
        }
    }

    unsubscribeAll() {
        this._listeners = [];
    }

    unsubscribe(listener) {
        const idx = this._listeners.indexOf(listener);
        if (idx != -1) {
            this._listeners.splice(idx, 1);
        } else {
            throw Error('Unknown listener for unsubscribe');
        }
    }

    /**
     * Notify subscribers.
     * When called, subscribers are notified by
     * calling their implementations of notifyCallbackName,
     * with state (from getStateCallback()) as the parameter.
     */
    notify() {
        const state = this._getStateCallback();
        for (const listener of this._listeners) {
            listener[this._notifyCallbackName](state);
        }
    }
}
