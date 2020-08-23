/* eslint-disable no-mixed-operators */
/* eslint-disable no-multi-spaces */
/* eslint-disable no-console */
/* eslint-disable prefer-destructuring */
/* eslint-disable no-underscore-dangle */
/* eslint-disable default-case */
/* eslint-disable max-len */
/* eslint-disable func-names */
/* eslint-disable no-use-before-define */
/* eslint-disable guard-for-in */
/* eslint-disable no-useless-constructor */
/* eslint-disable no-plusplus */
/* eslint-disable prefer-const */
/* eslint-disable eqeqeq */
/* eslint-disable camelcase */
/* eslint-disable no-nested-ternary */
/*
 * Copyright (C) 2018 Intel Corporation
 *
 * SPDX-License-Identifier: MIT
 */

/* exported PolyShapeModel buildShapeModel buildShapeController buildShapeView PolyShapeView */

/* global
    AAMUndefinedKeyword:false
    blurAllElements:false
    drawBoxSize:false
    Listener:false
    Logger:false
    Mousetrap:false
    ShapeCollectionView:false
    SVG:false
    LabelsInfo:false
*/

'use strict';

const STROKE_WIDTH = 2.5;
const SELECT_POINT_STROKE_WIDTH = 2.5;
const POINT_RADIUS = 5;
const AREA_TRESHOLD = 9;
const TEXT_MARGIN = 10;

/** ****************************** JSDOC OBJECT  ******************************* */

/**
 * Pair of attribute name and deserialized value,
 * mainly for client to render data.
 *
 * @typedef {Object} AttrNameVal
 * @property {string} name Name of the attribute.
 * @property {(string|number|boolean)} value Value of the attribute.
 */

/**
 * Pair of attribute ID and serialized value,
 * mainly for data exchange between client and server.
 *
 * @typedef {Object} AttrIdVal
 * @property {number} id ID of the attribute.
 * @property {string} value Value of the attribute.
 */

/**
 * Shape information in a particular frame.
 *
 * @typedef {Object} ShapeInFrame
 * @property {AttrNameVal} attributes Attributes of the shape.
 * @property {Object} position Position of the shape. More precisely,
 *                             it is a BoxPosition if the shape is a box.
 */

/**
 * Position of a box, along with some metadata for rendering.
 *
 * @typedef BoxPosition
 * @type {object}
 * @property {number} xtl
 * @property {number} ytl
 * @property {number} xbr
 * @property {number} ybr
 * @property {boolean} occluded
 * @property {boolean} outside Is the shape outside of the view?
 * @property {number} z_order
 */

/**
 * A simple 2D point.
 *
 * @typedef Point
 * @type {Object}
 * @property {number} x
 * @property {number} y
 */

/** ****************************** SHAPE MODELS  ******************************* */

class ShapeModel extends Listener {
    /**
     * Construct a ShapeModel.
     * This is the base model for all other shapes.
     * It only defines common properties, attributes,...
     * Position data will be handled by children constructors.
     *
     * @param {Object} data        Raw shape data.
     * @param {Object[]} positions Raw shape position data. In Annotation mode, positions is [].
     * @param {string} type        Shape type string, of the following format:
     *                               {annotation_mode}_{shape_type}
     * @param {number} clientID    Client-side shape ID?
     * @param {{shape: string, ui: string}} color Color code.
     */
    constructor(data, positions, type, clientID, color) {
        super('onShapeUpdate', () => this);

        /** @type {number} */
        this._serverID = data.id;

        /** @type {number} */
        this._id = clientID;

        // _groupId = 0: no group
        this._groupId = data.group || 0;

        // Annotation type: {annotation_mode}_{shape_type}
        // add_mode could be interpolation or annotation
        // shape_type could be box, polygon,...
        /** @type {string} */
        this._type = type;

        // ID of the label
        this._label = data.label_id;

        this._color = color;

        this._frame = type.split('_')[0] === 'annotation'
            ? data.frame
            : positions.filter((pos) => pos.frame < window.cvat.player.frames.start).length
                ? window.cvat.player.frames.start
                : Math.min(...positions.map((pos) => pos.frame));

        this._removed = false;
        this._locked = false;
        this._merging = false;
        this._active = false;
        this._selected = false;
        this._activeAttributeId = null;
        this._merge = false;
        this._hiddenShape = false;
        this._hiddenText = true;
        this._updateReason = null;
        this._clipToFrame = true;
        this._importAttributes(data.attributes, positions);
    }

    /**
     * Import attributes from raw data.
     * This function populates this._attributes.
     *
     * @param {AttrIdVal[]} attributes List of attribute id and value.
     * @param {Object[]} positions List of positions.
     */
    _importAttributes(attributes, positions) {
        // Convert attributes to a dictionary.
        // Key is attribute ID, value is attribute value.
        const tmp = {};
        for (const attr of attributes) {
            tmp[attr.id] = attr.value;
        }
        attributes = tmp;

        this._attributes = {
            mutable: {},      // Nested dict. First key is frame number, second key is attribute ID, value is attribute value.
            immutable: {},    // Key is attribute ID, value is attribute value. Mutable = change between frames.
        };

        const { labelsInfo } = window.cvat;
        const labelAttributes = labelsInfo.labelAttributes(this._label);

        // Fill this._attributes with default values.
        for (const attrId in labelAttributes) {
            const attrInfo = labelsInfo.attrInfo(attrId);
            if (attrInfo.mutable) {
                this._attributes.mutable[this._frame] = this._attributes.mutable[this._frame] || {};
                this._attributes.mutable[this._frame][attrId] = attrInfo.values[0];
            } else {
                this._attributes.immutable[attrId] = attrInfo.values[0];
            }
        }

        // Fill this._attributes with values from attributes.
        for (const attrId in attributes) {
            const attrInfo = labelsInfo.attrInfo(attrId);
            const labelValue = LabelsInfo.normalize(attrInfo.type, attributes[attrId]);
            if (attrInfo.mutable) {
                this._attributes.mutable[this._frame][attrId] = labelValue;
            } else {
                this._attributes.immutable[attrId] = labelValue;
            }
        }

        // Fill this._attributes with values for each position.
        for (const pos of positions) {
            for (const attr of pos.attributes) {
                const attrInfo = labelsInfo.attrInfo(attr.id);
                if (attrInfo.mutable) {
                    this._attributes.mutable[pos.frame] = this._attributes.mutable[pos.frame] || {};
                    const labelValue = LabelsInfo.normalize(attrInfo.type, attr.value);
                    this._attributes.mutable[pos.frame][attr.id] = labelValue;
                }
            }
        }
    }

    /**
     * Given the frame number, return the attributes of the shape in that frame.
     * The returned object is a dict. The key is the attribute ID, the value is
     * an object containing attribute name and value.
     *
     * @param {number} frame Frame number.
     * @returns {Object.<number, AttrNameVal>} Dict of AttrNameVal keyed with attribute ID.
     */
    _interpolateAttributes(frame) {
        const { labelsInfo } = window.cvat;
        const interpolated = {};

        for (const attrId in this._attributes.immutable) {
            const attrInfo = labelsInfo.attrInfo(attrId);
            interpolated[attrId] = {
                name: attrInfo.name,
                value: this._attributes.immutable[attrId],
            };
        }

        if (!Object.keys(this._attributes.mutable).length) {
            return interpolated;
        }

        // Prepare a dict of attribute ID-name, for faster lookup in the next loop.
        const mutableAttributes = {};
        for (const attrId in window.cvat.labelsInfo.labelAttributes(this._label)) {
            const attrInfo = window.cvat.labelsInfo.attrInfo(attrId);
            if (attrInfo.mutable) {
                mutableAttributes[attrId] = attrInfo.name;
            }
        }

        // Add attributes
        for (const attrId in mutableAttributes) {
            for (let frameKey in this._attributes.mutable) {
                frameKey = +frameKey;

                // Reasonable explanation for the 2nd operand of &&:
                // It relies on de facto iteration order.
                // https://stackoverflow.com/a/5525820/5959593
                // As this loop iterates in ascending order, the later frameKey
                // will override the earlier, so that interpolated[attrId]
                // will have the value of the nearest frameKey not after frame.
                if (attrId in this._attributes.mutable[frameKey]    // Isn't it always true???
                    && (frameKey <= frame                           // If the frame is after frameKey, update interpolated[attrID]
                        || !(attrId in interpolated))) {            // else only update if it's not there???
                    interpolated[attrId] = {
                        name: mutableAttributes[attrId],
                        value: this._attributes.mutable[frameKey][attrId],
                    };
                }
            }

            if (!(attrId != interpolated)) {    // WTF???
                throw Error(`Keyframe for mutable attribute not found. Frame: ${frame}, attributeId: ${attrId}`);
            }
        }

        return interpolated;
    }

    _neighboringFrames(frame) {
        if (!Number.isInteger(frame) || frame < 0) {
            throw Error(`Got invalid frame: ${frame}`);
        }

        let leftFrame = null;
        let rightFrame = null;

        for (let frameKey in this._positions) {
            frameKey = +frameKey;
            if (frameKey < frame && (frameKey > leftFrame || leftFrame === null)) {
                leftFrame = frameKey;
            }

            if (frameKey > frame && (frameKey < rightFrame || rightFrame === null)) {
                rightFrame = frameKey;
            }
        }

        return [leftFrame, rightFrame];
    }

    // Function mark frames which contain attribute updates as key frames
    _setupKeyFrames() {
        for (const frame in this._attributes.mutable) {
            if (!(frame in this._positions)) {
                const position = this._interpolatePosition(+frame);
                this.updatePosition(+frame, position, true);
            }
        }
    }

    _computeFrameCount() {
        if (this._type.split('_')[0] === 'annotation') {
            return 1;
        }

        let counter = 0;
        let visibleFrame = null;
        let hiddenFrame = null;
        let last = 0;
        for (const frame in this._positions) {
            if (visibleFrame === null && !this._positions[frame].outside) {
                visibleFrame = +frame;
            } else if (visibleFrame != null && this._positions[frame].outside) {
                hiddenFrame = +frame;
                counter += hiddenFrame - visibleFrame;
                visibleFrame = null;
                hiddenFrame = null;
            }
            last = +frame;
        }

        if (visibleFrame != null) {
            if (this._type === 'interpolation_box'
                || this._type === 'interpolation_points') {
                counter += window.cvat.player.frames.stop - visibleFrame + 1;
            } else {
                counter += last - visibleFrame + 1;
            }
        }
        return counter;
    }

    /**
     * @param {string} updateReason Update reasons:
     *     attributes, activation, changelabel, color, click, occluded,
     *     lock, hidden, outside, keyframe, selection, z_order, remove,
     *     activeAttribute, merge, grouping, position, draggable
     */
    notify(updateReason) {
        if (updateReason !== 'activation') {
            // eslint-disable-next-line no-unused-vars
            const what = 1;
        }

        const oldReason = this._updateReason;
        this._updateReason = updateReason;
        try {
            Listener.prototype.notify.call(this);
        } finally {
            this._updateReason = oldReason;
        }
    }

    collectStatistic() {
        const collectObj = {};
        collectObj.type = this._type.split('_')[1];
        collectObj.mode = this._type.split('_')[0];
        collectObj.labelId = this._label;
        collectObj.manually = Object.keys(this._positions).length;
        for (const frame in this._positions) {
            if (this._positions[frame].outside) {
                collectObj.manually--;
            }
        }
        collectObj.total = this._computeFrameCount();
        collectObj.interpolated = collectObj.total - collectObj.manually;

        return collectObj;
    }

    updateAttribute(frame, attrId, value) {
        const { labelsInfo } = window.cvat;
        const attrInfo = labelsInfo.attrInfo(attrId);

        Logger.addEvent(Logger.EventType.changeAttribute, {
            attrId,
            value,
            attrName: attrInfo.name,
        });

        // Undo/redo code
        const oldAttr = attrInfo.mutable
            ? this._attributes.mutable[frame]
                ? this._attributes.mutable[frame][attrId]
                : undefined
            : this._attributes.immutable[attrId];

        window.cvat.addAction(
            'Change Attribute',
            () => {
                if (typeof (oldAttr) === 'undefined') {
                    delete this._attributes.mutable[frame][attrId];
                    this.notify('attributes');
                } else {
                    this.updateAttribute(frame, attrId, oldAttr);
                }
            },
            () => {
                this.updateAttribute(frame, attrId, value);
            },
            frame,
        );
        // End of undo/redo code

        if (attrInfo.mutable) {
            this._attributes.mutable[frame] = this._attributes.mutable[frame] || {};
            this._attributes.mutable[frame][attrId] = LabelsInfo.normalize(attrInfo.type, value);
            this._setupKeyFrames();
        } else {
            this._attributes.immutable[attrId] = LabelsInfo.normalize(attrInfo.type, value);
        }

        this.notify('attributes');
    }

    changeLabel(labelId) {
        Logger.addEvent(Logger.EventType.changeLabel, {
            from: this._label,
            to: labelId,
        });

        if (labelId in window.cvat.labelsInfo.labels()) {
            this._label = +labelId;
            this._importAttributes([], []);
            this._setupKeyFrames();
            this.notify('changelabel');
        } else {
            throw Error(`Unknown label id value found: ${labelId}`);
        }
    }

    changeColor(color) {
        this._color = color;
        this.notify('color');
    }

    /**
     * Given the frame number, return the attributes and position
     * of this object in that frame.
     * This function is needed as Shapes in an interpolated series
     * are treated as one shape.
     *
     * @param {number} frame Frame number.
     * @returns {ShapeInFrame} Attributes and position of the shape in the frame.
     */
    interpolate(frame) {
        return {
            attributes: this._interpolateAttributes(frame),
            position: this._interpolatePosition(frame),    // Each shape has its own _interpolatePosition, or doesn't have it at all.
        };
    }

    switchOccluded(frame) {
        const position = this._interpolatePosition(frame);
        position.occluded = !position.occluded;

        // Undo/redo code
        window.cvat.addAction('Change Occluded', () => {
            this.switchOccluded(frame);
        }, () => {
            this.switchOccluded(frame);
        }, frame);
        // End of undo/redo code

        this.updatePosition(frame, position, true);
        this.notify('occluded');
    }

    switchLock() {
        this._locked = !this._locked;
        this.notify('lock');
    }

    switchHide() {
        if (!this._hiddenText) {
            this._hiddenText = true;
            this._hiddenShape = false;
        } else if (this._hiddenText && !this._hiddenShape) {
            this._hiddenShape = true;
            this._hiddenText = true;
        } else if (this._hiddenText && this._hiddenShape) {
            this._hiddenShape = false;
            this._hiddenText = false;
        }

        this.notify('hidden');
    }

    switchOutside(frame) {
        // Only for interpolation shapes
        if (this._type.split('_')[0] !== 'interpolation') {
            return;
        }

        // Undo/redo code
        const oldPos = Object.assign({}, this._positions[frame]);
        window.cvat.addAction('Change Outside', () => {
            if (!Object.keys(oldPos).length) {
                // Frame hasn't been a keyframe, remove it from position and redistribute attributes
                delete this._positions[frame];
                this._frame = Math.min(...Object.keys(this._positions).map((el) => +el));
                if (frame < this._frame && frame in this._attributes.mutable) {
                    this._attributes.mutable[this._frame] = this._attributes.mutable[frame];
                }

                if (frame in this._attributes.mutable) {
                    delete this._attributes.mutable[frame];
                }

                this.notify('outside');
            } else {
                this.switchOutside(frame);
            }
        }, () => {
            this.switchOutside(frame);
        }, frame);
        // End of undo/redo code

        const position = this._interpolatePosition(frame);
        position.outside = !position.outside;
        this.updatePosition(frame, position, true);

        // Update the start frame if need and redistribute attributes
        if (frame < this._frame) {
            if (this._frame in this._attributes.mutable) {
                this._attributes.mutable[frame] = this._attributes.mutable[this._frame];
                delete (this._attributes.mutable[this._frame]);
            }
            this._frame = frame;
        }

        this.notify('outside');
    }

    switchKeyFrame(frame) {
        // Only for interpolation shapes
        if (this._type.split('_')[0] !== 'interpolation') {
            return;
        }

        // Undo/redo code
        const oldPos = Object.assign({}, this._positions[frame]);
        window.cvat.addAction('Change Keyframe', () => {
            this.switchKeyFrame(frame);
            if (frame in this._positions) {
                this.updatePosition(frame, oldPos);
            }
        }, () => {
            this.switchKeyFrame(frame);
        }, frame);
        // End of undo/redo code

        if (frame in this._positions && Object.keys(this._positions).length > 1) {
            // If frame is first object frame, need redistribute attributes
            if (frame === this._frame) {
                this._frame = Object.keys(this._positions).map((el) => +el).sort((a, b) => a - b)[1];
                if (frame in this._attributes.mutable) {
                    this._attributes.mutable[this._frame] = this._attributes.mutable[frame];
                    delete (this._attributes.mutable[frame]);
                }
            }
            delete (this._positions[frame]);
        } else {
            const position = this._interpolatePosition(frame);
            this.updatePosition(frame, position, true);

            if (frame < this._frame) {
                if (this._frame in this._attributes.mutable) {
                    this._attributes.mutable[frame] = this._attributes.mutable[this._frame];
                    delete (this._attributes.mutable[this._frame]);
                }
                this._frame = frame;
            }
        }

        this.notify('keyframe');
    }

    click() {
        this.notify('click');
    }

    prevKeyFrame() {
        return this._neighboringFrames(window.cvat.player.frames.current)[0];
    }

    nextKeyFrame() {
        return this._neighboringFrames(window.cvat.player.frames.current)[1];
    }

    initKeyFrame() {
        return this._frame;
    }

    isKeyFrame(frame) {
        return frame in this._positions;
    }

    select() {
        if (!this._selected) {
            this._selected = true;
            this.notify('selection');
        }
    }

    deselect() {
        if (this._selected) {
            this._selected = false;
            this.notify('selection');
        }
    }

    /**
     * Remove model.
     * Model is "removed" by setting the removed attribute.
     * disableUndoRedo is true only in the case of splitting box.
     * In that case, the removed model (a BoxModel) is also returned,
     * so that undo and redo is possible.
     *
     * @param {?boolean} disableUndoRedo Disable undo/redo, as splitting
     *                                   has its own undo/redo code.
     * @returns {?BoxModel} Returns the deleted model if disableUndoRedo is true.
     */
    remove(disableUndoRedo = false) {
        Logger.addEvent(Logger.EventType.deleteObject, { count: 1 });

        // Also notify subscribers.
        this.removed = true;

        if (!disableUndoRedo) {
            // Undo/redo code
            window.cvat.addAction(
                'Remove Object',
                () => {
                    this.removed = false;
                },
                () => {
                    this.removed = true;
                },
                window.cvat.player.frames.current,
            );
            // End of undo/redo code
        } else {
            return this;
        }
    }

    /**
     * @param {any} value
     */
    set z_order(value) {
        if (!this._locked) {
            const frame = window.cvat.player.frames.current;
            const position = this._interpolatePosition(frame);
            position.z_order = value;
            this.updatePosition(frame, position, true);
            this.notify('z_order');
        }
    }

    set removed(value) {
        if (value) {
            this._active = false;
            this._serverID = undefined;
        }

        this._removed = value;
        this.notify('remove');
    }

    get removed() {
        return this._removed;
    }

    get lock() {
        return this._locked;
    }

    get hiddenShape() {
        return this._hiddenShape;
    }

    get hiddenText() {
        return this._hiddenText;
    }

    /**
     * Set active status.
     *
     * @param {boolean} value Active status.
     */
    set active(value) {
        this._active = value;
        if (!this._removed && !['drag', 'resize'].includes(window.cvat.mode)) {
            this.notify('activation');
        }
    }

    get active() {
        return this._active;
    }

    set activeAttribute(value) {
        this._activeAttributeId = value;
        this.notify('activeAttribute');
    }

    get activeAttribute() {
        return this._activeAttributeId;
    }

    set merge(value) {
        this._merge = value;
        this.notify('merge');
    }

    get merge() {
        return this._merge;
    }

    set groupping(value) {
        this._groupping = value;
        this.notify('groupping');
    }

    get groupping() {
        return this._groupping;
    }

    set groupId(value) {
        this._groupId = value;
    }

    get groupId() {
        return this._groupId;
    }

    get type() {
        return this._type;
    }

    get id() {
        return this._id;
    }

    set id(value) {
        this._id = value;
    }

    get serverID() {
        return this._serverID;
    }

    set serverID(value) {
        this._serverID = value;
    }

    get frame() {
        return this._frame;
    }

    get color() {
        return this._color;
    }

    get updateReason() {
        return this._updateReason;
    }

    get label() {
        return this._label;
    }

    get keyframes() {
        return Object.keys(this._positions);
    }

    get selected() {
        return this._selected;
    }

    get clipToFrame() {
        return this._clipToFrame;
    }

    /**
     * Check if the shape can be split geometrically (not to be confused with split interpolation feature).
     * The shape is splittable only if it is an annotated shape, and must be either a BoxModel or PolygonModel.
     */
    get splittable() {
        return this.type.split('_')[0] === 'annotation' && (
            this instanceof BoxModel
            || this instanceof PolygonModel
        );
    }
}

class BoxModel extends ShapeModel {
    /**
     * Construct a BoxModel.
     *
     * @param {Object} data     Raw shape data.
     * @param {string} type     Shape type string, of the following format:
     *                            {annotation_mode}_box
     * @param {number} clientID Client side ID?
     * @param {string} color    Color code.
     */
    constructor(data, type, clientID, color) {
        super(data, data.shapes || [], type, clientID, color);

        /** @type {Object.<number, Position>} */
        this._positions = BoxModel.importPositions.call(this, data.shapes || data);

        this._setupKeyFrames();
    }

    /**
     * Given the frame number, return the position of the box in that frame.
     * Position is interpolated when needed (contain(), distance()), instead of being cached.
     *
     * @param {number} frame Frame number.
     * @returns {BoxPosition} Position of the box in that frame.
     */
    _interpolatePosition(frame) {
        if (this._type.startsWith('annotation')) {
            return Object.assign({},
                this._positions[this._frame],
                { outside: this._frame != frame });
        }

        let [leftFrame, rightFrame] = this._neighboringFrames(frame);
        if (frame in this._positions) {
            leftFrame = frame;
        }

        let leftPos = null;
        let rightPos = null;

        if (leftFrame != null) leftPos = this._positions[leftFrame];
        if (rightFrame != null) rightPos = this._positions[rightFrame];

        if (!leftPos) {
            if (rightPos) {
                return Object.assign({},
                    rightPos,
                    { outside: true });
            }

            return { outside: true };
        }

        if (frame === leftFrame || leftPos.outside || !rightPos || rightPos.outside) {
            return Object.assign({}, leftPos);
        }

        const moveCoeff = (frame - leftFrame) / (rightFrame - leftFrame);

        return {
            xtl: leftPos.xtl + (rightPos.xtl - leftPos.xtl) * moveCoeff,
            ytl: leftPos.ytl + (rightPos.ytl - leftPos.ytl) * moveCoeff,
            xbr: leftPos.xbr + (rightPos.xbr - leftPos.xbr) * moveCoeff,
            ybr: leftPos.ybr + (rightPos.ybr - leftPos.ybr) * moveCoeff,
            occluded: leftPos.occluded,
            outside: leftPos.outside,
            z_order: leftPos.z_order,
        };
    }

    _verifyArea(box) {
        return ((box.xbr - box.xtl) * (box.ybr - box.ytl) >= AREA_TRESHOLD);
    }

    updatePosition(frame, position, silent) {
        const pos = {
            xtl: Math.clamp(position.xtl, 0, window.cvat.player.geometry.frameWidth),
            ytl: Math.clamp(position.ytl, 0, window.cvat.player.geometry.frameHeight),
            xbr: Math.clamp(position.xbr, 0, window.cvat.player.geometry.frameWidth),
            ybr: Math.clamp(position.ybr, 0, window.cvat.player.geometry.frameHeight),
            occluded: position.occluded,
            z_order: position.z_order,
        };

        if (this._verifyArea(pos)) {
            if (this._type === 'annotation_box') {
                if (this._frame != frame) {
                    throw Error(`Got bad frame for annotation box during update position: ${frame}. Own frame is ${this._frame}`);
                }
            }

            if (!silent) {
                // Undo/redo code
                const oldPos = Object.assign({}, this._positions[frame]);
                window.cvat.addAction('Change Position', () => {
                    if (!Object.keys(oldPos).length) {
                        delete this._positions[frame];
                        this.notify('position');
                    } else {
                        this.updatePosition(frame, oldPos, false);
                    }
                }, () => {
                    this.updatePosition(frame, pos, false);
                }, frame);
                // End of undo/redo code
            }

            if (this._type === 'annotation_box') {
                this._positions[frame] = pos;
            } else {
                this._positions[frame] = Object.assign(pos, {
                    outside: position.outside,
                });
            }
        }

        if (!silent) {
            this.notify('position');
        }
    }

    /**
     * Given a position in the canvas and frame number, check if it is inside the box.
     *
     * @param {SVGPoint} mousePos Position (of the mouse) in canvas coordinate.
     * @param {number} frame Frame number.
     * @returns {boolean} Whether mousePos is inside the box or not.
     */
    contain(mousePos, frame) {
        const pos = this._interpolatePosition(frame);
        if (pos.outside) return false;
        const { x, y } = mousePos;
        return x >= pos.xtl && x <= pos.xbr && y >= pos.ytl && y <= pos.ybr;
    }

    /**
     * Given a position in the canvas and frame number, find the minimum
     * distance to an edge of the box.
     *
     * @param {SVGPoint} mousePos Position (of the mouse) in canvas coordinate.
     * @param {number} frame Frame number.
     * @returns {number} Minimum distance to an edge of the box.
     */
    distance(mousePos, frame) {
        const pos = this._interpolatePosition(frame);
        if (pos.outside) {
            return Number.MAX_SAFE_INTEGER;
        }

        const corners = [
            { x: pos.xtl, y: pos.ytl },
            { x: pos.xbr, y: pos.ytl },
            { x: pos.xbr, y: pos.ybr },
            { x: pos.xtl, y: pos.ybr },
        ];
        let minDistance = Number.MAX_SAFE_INTEGER;
        const { x, y } = mousePos;

        for (let i = 0; i < corners.length; i++) {
            const c1 = corners[i];
            const c2 = corners[i + 1] || corners[0];

            // Distance from pos to line p1p2
            const distance = Math.abs((c2.y - c1.y) * x - (c2.x - c1.x) * y + c2.x * c1.y - c2.y * c1.x)
                / Math.sqrt((c2.y - c1.y) ** 2 + (c2.x - c1.x) ** 2);

            // check if perpendicular belongs to the straight segment
            const a = (c1.x - x) ** 2    + (c1.y - y) ** 2;        // Squared distance between p1 and pos
            const b = (c2.x - c1.x) ** 2 + (c2.y - c1.y) ** 2;     // Squared distance between p2 and p1
            const c = (c2.x - x) ** 2    + (c2.y - y) ** 2;        // Squared distance between p2 and pos
            if (distance < minDistance && (a + b - c) >= 0 && (c + b - a) >= 0) {    // Aren't the last 2 conditions
                minDistance = distance;                                              // always true?
            }
        }

        return minDistance;
    }

    /**
     * Export the model.
     * Mostly it's the reverse of several import functions in the constructors.
     *
     * @returns {Object} Raw shape data. Should be of the same structure
     *                   as the data parameter passed to the constructor.
     */
    export() {
        /** @type {AttrIdVal[]} */
        const objectAttributes = [];
        for (const attributeId in this._attributes.immutable) {
            objectAttributes.push({
                id: +attributeId,
                value: String(this._attributes.immutable[attributeId]),
            });
        }

        if (this._type === 'annotation_box') {
            if (this._frame in this._attributes.mutable) {
                for (const attrId in this._attributes.mutable[this._frame]) {
                    objectAttributes.push({
                        id: +attrId,
                        value: String(this._attributes.mutable[this._frame][attrId]),
                    });
                }
            }

            return Object.assign(
                {
                    id: this._serverID,
                    attributes: objectAttributes,
                    label_id: this._label,
                    group: this._groupId,
                    frame: this._frame,
                    type: 'box',
                },
                this._positions[this._frame],
            );
        }

        const track = {
            id: this._serverID,
            label_id: this._label,
            group: this._groupId,
            frame: this._frame,
            attributes: objectAttributes,
            shapes: [],
        };

        for (const frame in this._positions) {
            const shapeAttributes = [];
            if (frame in this._attributes.mutable) {
                for (const attrId in this._attributes.mutable[frame]) {
                    shapeAttributes.push({
                        id: +attrId,
                        value: String(this._attributes.mutable[frame][attrId]),
                    });
                }
            }

            track.shapes.push(Object.assign(
                {
                    frame: +frame,
                    type: 'box',
                    attributes: shapeAttributes,
                },
                this._positions[frame],
            ));
        }

        return track;
    }

    removePoint() {
        // nothing do
    }

    /**
     * Create a dict of position, keyed by frame number.
     *
     * @returns {Object.<number, Position>} A dict of position, keyed by frame number.
     */
    static importPositions(positions) {
        const imported = {};
        if (this._type === 'interpolation_box') {
            let last_key_in_prev_segm = null;
            const segm_start = window.cvat.player.frames.start;
            const segm_stop = window.cvat.player.frames.stop;

            for (const pos of positions) {
                const { frame } = pos;

                if (frame >= segm_start && frame <= segm_stop) {
                    imported[frame] = {
                        xtl: pos.xtl,
                        ytl: pos.ytl,
                        xbr: pos.xbr,
                        ybr: pos.ybr,
                        occluded: pos.occluded,
                        outside: pos.outside,
                        z_order: pos.z_order,
                    };
                } else {
                    console.log(`Frame ${frame} has been found in segment [${segm_start}-${segm_stop}]. It have been ignored.`);
                    if (!last_key_in_prev_segm || frame > last_key_in_prev_segm.frame) {
                        last_key_in_prev_segm = pos;
                    }
                }
            }

            if (last_key_in_prev_segm && !(segm_start in imported)) {
                imported[segm_start] = {
                    xtl: last_key_in_prev_segm.xtl,
                    ytl: last_key_in_prev_segm.ytl,
                    xbr: last_key_in_prev_segm.xbr,
                    ybr: last_key_in_prev_segm.ybr,
                    occluded: last_key_in_prev_segm.occluded,
                    outside: last_key_in_prev_segm.outside,
                    z_order: last_key_in_prev_segm.z_order,
                };
            }

            return imported;
        }

        imported[this._frame] = {
            xtl: positions.xtl,
            ytl: positions.ytl,
            xbr: positions.xbr,
            ybr: positions.ybr,
            occluded: positions.occluded,
            z_order: positions.z_order,
        };

        return imported;
    }

    /**
     * Given a shape, check if it is adjacent to this one.
     * Adjacent means the 2 shapes must touch in at least one corner,
     * and they must be of the same type. Some minor spacing (2% of
     * canvas's larger side) between them is allowed.
     *
     * @param {ShapeModel} shape Model of the shape to be checked.
     * @returns {boolean} Whether shape is adjacent to this or not.
     */
    isAdjacentTo(shape) {
        if (!(shape instanceof BoxModel) || this.frame !== shape.frame) {
            return false;
        }

        const thisCorners = getCorners(this);
        const shapeCorners = getCorners(shape);

        for (const thisCorner of thisCorners) {
            for (const shapeCorner of shapeCorners) {
                if (isAdjacent(thisCorner, shapeCorner)) {
                    return true;
                }
            }
        }

        return false;

        /**
         * Get box's corners.
         *
         * @param {BoxModel} box
         * @returns {Point[]} List of corners, sorted clockwise, from the top left one.
         */
        function getCorners(box) {
            const { xtl, ytl, xbr, ybr } = box._positions[box.frame];
            return [
                { x: xtl, y: ytl },
                { x: xbr, y: ytl },
                { x: xbr, y: ybr },
                { x: xtl, y: ybr },
            ];
        }
    }

    /**
     * Given a point, check if it is adjacent to this shape.
     * See isAdjacentToShape() for adjacent criteria.
     *
     * @param {Point} point The point to be checked.
     * @returns {number} Index of corner adjacent to point, -1 if none is.
     */
    indexOfCornerAdjacentTo(point) {

    }
}

class PolyShapeModel extends ShapeModel {
    constructor(data, type, clientID, color) {
        super(data, data.shapes || [], type, clientID, color);
        this._positions = PolyShapeModel.importPositions.call(this, data.shapes || data);
        this._setupKeyFrames();
    }

    /**
     * Given the frame number, return the position of the shape in that frame.
     * Position is interpolated when needed (contain(), distance()), instead of being cached.
     *
     * @param {number} frame Frame number.
     * @returns {Object} Position of the shape in that frame.
     */
    _interpolatePosition(frame) {
        if (this._type.startsWith('annotation')) {
            return Object.assign({},
                this._positions[this._frame],
                { outside: this._frame != frame });
        }

        let [leftFrame, rightFrame] = this._neighboringFrames(frame);
        if (frame in this._positions) {
            leftFrame = frame;
        }

        let leftPos = null;
        let rightPos = null;

        if (leftFrame != null) leftPos = this._positions[leftFrame];
        if (rightFrame != null) rightPos = this._positions[rightFrame];

        if (!leftPos) {
            if (rightPos) {
                return Object.assign({},
                    rightPos,
                    { outside: true });
            }

            return { outside: true };
        }

        return Object.assign({},
            leftPos,
            { outside: leftPos.outside || leftFrame !== frame });
    }

    /**
     * @param {number} frame
     * @param {Object} position
     * @param {boolean} silent
     */
    updatePosition(frame, position, silent) {
        const box = {
            xtl: Number.MAX_SAFE_INTEGER,
            ytl: Number.MAX_SAFE_INTEGER,
            xbr: Number.MIN_SAFE_INTEGER,
            ybr: Number.MIN_SAFE_INTEGER,
        };

        const points = PolyShapeModel.convertStringToNumberArray(position.points);
        for (const point of points) {
            if (this.clipToFrame) {
                point.x = Math.clamp(point.x, 0, window.cvat.player.geometry.frameWidth);
                point.y = Math.clamp(point.y, 0, window.cvat.player.geometry.frameHeight);
            }

            box.xtl = Math.min(box.xtl, point.x);
            box.ytl = Math.min(box.ytl, point.y);
            box.xbr = Math.max(box.xbr, point.x);
            box.ybr = Math.max(box.ybr, point.y);
        }
        position.points = PolyShapeModel.convertNumberArrayToString(points);

        const pos = {
            height: box.ybr - box.ytl,
            width: box.xbr - box.xtl,
            occluded: position.occluded,
            points: position.points,
            z_order: position.z_order,
        };

        if (this._verifyArea(box)) {
            if (!silent) {
                // Undo/redo code
                const oldPos = Object.assign({}, this._positions[frame]);
                window.cvat.addAction(
                    'Change Position',
                    () => {
                        if (!Object.keys(oldPos).length) {
                            delete this._positions[frame];
                            this.notify('position');
                        } else {
                            this.updatePosition(frame, oldPos, false);
                        }
                    },
                    () => {
                        this.updatePosition(frame, pos, false);
                    },
                    frame,
                );
                // End of undo/redo code
            }

            if (this._type.startsWith('annotation')) {
                if (this._frame !== frame) {
                    throw Error(`Got bad frame for annotation poly shape during update position: ${frame}. Own frame is ${this._frame}`);
                }
                this._positions[frame] = pos;
            } else {
                this._positions[frame] = Object.assign(pos, { outside: position.outside });
            }
        }

        if (!silent) {
            this.notify('position');
        }
    }

    /**
     * Export the model.
     * Mostly it's the reverse of several import functions in the constructors.
     *
     * @returns {Object} Raw shape data. Should be of the same structure
     *                   as the data parameter passed to the constructor.
     */
    export() {
        /**
         * List of pairs of attribute ID and value.
         *
         * @type {AttrIdVal[]}
         */
        const objectAttributes = [];

        for (const attrId in this._attributes.immutable) {
            objectAttributes.push({
                id: +attrId,
                value: String(this._attributes.immutable[attrId]),
            });
        }

        if (this._type.startsWith('annotation')) {
            if (this._frame in this._attributes.mutable) {
                for (const attrId in this._attributes.mutable[this._frame]) {
                    objectAttributes.push({
                        id: +attrId,
                        value: String(this._attributes.mutable[this._frame][attrId]),
                    });
                }
            }

            return Object.assign(
                {
                    id: this._serverID,
                    attributes: objectAttributes,
                    label_id: this._label,
                    group: this._groupId,
                    frame: this._frame,
                    type: this._type.split('_')[1],
                },
                this._positions[this._frame],
            );
        }

        const track = {
            id: this._serverID,
            attributes: objectAttributes,
            label_id: this._label,
            group: this._groupId,
            frame: this._frame,
            shapes: [],
        };

        for (const frame in this._positions) {
            const shapeAttributes = [];
            if (frame in this._attributes.mutable) {
                for (const attrId in this._attributes.mutable[frame]) {
                    shapeAttributes.push({
                        id: +attrId,
                        value: String(this._attributes.mutable[frame][attrId]),
                    });
                }
            }

            track.shapes.push(Object.assign(
                {
                    frame: +frame,
                    attributes: shapeAttributes,
                    type: this._type.split('_')[1],
                },
                this._positions[frame],
            ));
        }

        return track;
    }

    removePoint(idx) {
        const frame = window.cvat.player.frames.current;
        const position = this._interpolatePosition(frame);
        const points = PolyShapeModel.convertStringToNumberArray(position.points);
        if (points.length > this._minPoints) {
            points.splice(idx, 1);
            position.points = PolyShapeModel.convertNumberArrayToString(points);
            this.updatePosition(frame, position);
        }
    }

    /**
     * Deserialize points (serialized in window.cvat.translate.points.serverToClient).
     *
     * @param {string} serializedPoints Serialized points.
     * @returns {Point[]} Deserialized points.
     */
    static convertStringToNumberArray(serializedPoints) {
        // const pointArray = [];
        // for (const pair of serializedPoints.split(' ')) {
        //     pointArray.push({
        //         x: +pair.split(',')[0],
        //         y: +pair.split(',')[1],
        //     });
        // }
        // return pointArray;

        return serializedPoints
            .split(' ')
            .map(pair => {
                pair = pair.split(',');
                return {
                    x: +pair[0],
                    y: +pair[1],
                };
            });
    }

    /**
     * The reverse of convertStringToNumberArray().
     *
     * @param {Point[]} arrayPoints Deserialized points.
     * @returns {string} Serialized points.
     */
    static convertNumberArrayToString(arrayPoints) {
        return arrayPoints.map(point => `${point.x},${point.y}`).join(' ');
    }

    /**
     * Convert raw position data to position data for the PolyShapeModel.
     *
     * @param {Object} positions Raw position data.
     * @return {Object.<number, Object>} Shape data, keyed with frame number.
     */
    static importPositions(positions) {
        /**
         * Get width and height of the rectangular bounding box of the shape.
         *
         * @param {string} points Serialized points of the shape.
         * @returns {number[]} Array of 2 numbers, which are the width
         *                     and height of the rectangular bounding box.
         */
        function getBBRect(points) {
            const box = {
                xtl: Number.MAX_SAFE_INTEGER,
                ytl: Number.MAX_SAFE_INTEGER,
                xbr: Number.MIN_SAFE_INTEGER,
                ybr: Number.MIN_SAFE_INTEGER,
            };

            for (const point of PolyShapeModel.convertStringToNumberArray(points)) {
                box.xtl = Math.min(box.xtl, point.x);
                box.ytl = Math.min(box.ytl, point.y);
                box.xbr = Math.max(box.xbr, point.x);
                box.ybr = Math.max(box.ybr, point.y);
            }

            return [box.xbr - box.xtl, box.ybr - box.ytl];
        }

        const imported = {};
        if (this._type.startsWith('interpolation')) {
            let last_key_in_prev_segm = null;
            const segm_start = window.cvat.player.frames.start;
            const segm_stop = window.cvat.player.frames.stop;

            for (const pos of positions) {
                const { frame } = pos;
                if (frame >= segm_start && frame <= segm_stop) {
                    const [width, height] = getBBRect(pos.points);
                    imported[pos.frame] = {
                        width,
                        height,
                        points: pos.points,
                        occluded: pos.occluded,
                        outside: pos.outside,
                        z_order: pos.z_order,
                    };
                } else {
                    console.log(`Frame ${frame} has been found in segment [${segm_start}-${segm_stop}]. It have been ignored.`);
                    if (!last_key_in_prev_segm || frame > last_key_in_prev_segm.frame) {
                        last_key_in_prev_segm = pos;
                    }
                }
            }

            if (last_key_in_prev_segm && !(segm_start in imported)) {
                const [width, height] = getBBRect(last_key_in_prev_segm.points);
                imported[segm_start] = {
                    width,
                    height,
                    points: last_key_in_prev_segm.points,
                    occluded: last_key_in_prev_segm.occluded,
                    outside: last_key_in_prev_segm.outside,
                    z_order: last_key_in_prev_segm.z_order,
                };
            }

            return imported;
        }

        const [width, height] = getBBRect(positions.points);
        imported[this._frame] = {
            width,
            height,
            points: positions.points,
            occluded: positions.occluded,
            z_order: positions.z_order,
        };

        return imported;
    }
}

class PointsModel extends PolyShapeModel {
    constructor(data, type, clientID, color) {
        super(data, type, clientID, color);
        this._minPoints = 1;
    }

    /**
     * Given the frame number, return the position of the shape in that frame.
     * Position is interpolated when needed (contain(), distance()), instead of being cached.
     *
     * @param {number} frame Frame number.
     * @returns {Object} Position of the shape in that frame.
     */
    _interpolatePosition(frame) {
        if (this._type.startsWith('annotation')) {
            return Object.assign({},
                this._positions[this._frame],
                { outside: this._frame !== frame });
        }

        let [leftFrame, rightFrame] = this._neighboringFrames(frame);
        if (frame in this._positions) {
            leftFrame = frame;
        }

        let leftPos = null;
        let rightPos = null;

        if (leftFrame != null) leftPos = this._positions[leftFrame];
        if (rightFrame != null) rightPos = this._positions[rightFrame];

        if (!leftPos) {
            if (rightPos) {
                return Object.assign({},
                    rightPos,
                    { outside: true });
            }

            return { outside: true };
        }

        if (frame === leftFrame || leftPos.outside || !rightPos || rightPos.outside) {
            return Object.assign({}, leftPos);
        }

        const rightPoints = PolyShapeModel.convertStringToNumberArray(rightPos.points);
        const leftPoints = PolyShapeModel.convertStringToNumberArray(leftPos.points);

        if (rightPoints.length === leftPoints.length && leftPoints.length === 1) {
            const moveCoeff = (frame - leftFrame) / (rightFrame - leftFrame);
            const interpolatedPoints = [{
                x: leftPoints[0].x + (rightPoints[0].x - leftPoints[0].x) * moveCoeff,
                y: leftPoints[0].y + (rightPoints[0].y - leftPoints[0].y) * moveCoeff,
            }];

            return Object.assign({},
                leftPos,
                { points: PolyShapeModel.convertNumberArrayToString(interpolatedPoints) });
        }

        return Object.assign({},
            leftPos,
            { outside: true });
    }

    /**
     * The same as BoxModel::distance(), but find distance to point.
     *
     * @param {SVGPoint} mousePos Position (of the mouse) in canvas coordinate.
     * @param {number} frame Frame number.
     * @returns {number} Minimum distance to a point of the shape.
     */
    distance(mousePos, frame) {
        const pos = this._interpolatePosition(frame);
        if (pos.outside) {
            return Number.MAX_SAFE_INTEGER;
        }

        const points = PolyShapeModel.convertStringToNumberArray(pos.points);
        let minDistance = Number.MAX_SAFE_INTEGER;

        for (const point of points) {
            const distance = Math.sqrt(Math.pow(point.x - mousePos.x, 2) + Math.pow(point.y - mousePos.y, 2));
            if (distance < minDistance) {
                minDistance = distance;
            }
        }
        return minDistance;
    }

    _verifyArea() {
        return true;
    }
}

class PolylineModel extends PolyShapeModel {
    constructor(data, type, clientID, color) {
        super(data, type, clientID, color);
        this._minPoints = 2;
    }

    _verifyArea(box) {
        return ((box.xbr - box.xtl) >= AREA_TRESHOLD || (box.ybr - box.ytl) >= AREA_TRESHOLD);
    }

    /**
     * The same as BoxModel::distance(), but find distance to line of the shape, not the bounding box.
     *
     * @param {SVGPoint} mousePos Position (of the mouse) in canvas coordinate.
     * @param {number} frame Frame number.
     * @returns {number} Minimum distance to a line of the shape.
     */
    distance(mousePos, frame) {
        const pos = this._interpolatePosition(frame);
        if (pos.outside) return Number.MAX_SAFE_INTEGER;
        const points = PolyShapeModel.convertStringToNumberArray(pos.points);
        let minDistance = Number.MAX_SAFE_INTEGER;
        for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i];
            const p2 = points[i + 1];

            // perpendicular from point to straight length
            const distance = (Math.abs((p2.y - p1.y) * mousePos.x - (p2.x - p1.x) * mousePos.y + p2.x * p1.y - p2.y * p1.x))
                / Math.sqrt(Math.pow(p2.y - p1.y, 2) + Math.pow(p2.x - p1.x, 2));

            // check if perpendicular belongs to the straight segment
            const a = Math.pow(p1.x - mousePos.x, 2) + Math.pow(p1.y - mousePos.y, 2);
            const b = Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2);
            const c = Math.pow(p2.x - mousePos.x, 2) + Math.pow(p2.y - mousePos.y, 2);
            if (distance < minDistance && (a + b - c) >= 0 && (c + b - a) >= 0) {
                minDistance = distance;
            }
        }
        return minDistance;
    }
}

class PolygonModel extends PolyShapeModel {
    constructor(data, type, id, color) {
        super(data, type, id, color);

        /** @type {number} */
        this._minPoints = 3;

        this._draggable = false;
    }

    _verifyArea(box) {
        return ((box.xbr - box.xtl) * (box.ybr - box.ytl) >= AREA_TRESHOLD);
    }

    /**
     * Given a position in the canvas and frame number, check if it is inside the polygon.
     * The algorithm used is winding number.
     *
     * @param {SVGPoint} mousePos Position (of the mouse) in canvas coordinate.
     * @param {number} frame Frame number.
     * @returns {boolean} Whether mousePos is inside the polygon or not.
     */
    contain(mousePos, frame) {
        const pos = this._interpolatePosition(frame);
        if (pos.outside) {
            return false;
        }

        const corners = PolyShapeModel.convertStringToNumberArray(pos.points);
        let wn = 0;

        for (let i = 0; i < corners.length; i++) {
            const c1 = corners[i];
            const c2 = corners[i + 1] || corners[0];

            if (c1.y <= mousePos.y) {
                if (c2.y > mousePos.y) {
                    if (isLeft(c1, c2, mousePos) > 0) {
                        wn++;
                    }
                }
            } else if (c2.y < mousePos.y) {
                if (isLeft(c1, c2, mousePos) < 0) {
                    wn--;
                }
            }
        }

        return wn != 0;

        /**
         * Check if P2 is on the left, right, or on the line of vector P0P1.
         * This is basically a cross product of 2 vectors P0P1 and P0P2.
         *
         * @returns {number} Positive number if on the left, negative number if on the right, zero if on the line.
         */
        function isLeft(P0, P1, P2) {
            return (P1.x - P0.x) * (P2.y - P0.y) - (P2.x - P0.x) * (P1.y - P0.y);
        }
    }

    /**
     * The same as BoxModel::distance().
     *
     * @param {SVGPoint} mousePos Position (of the mouse) in canvas coordinate.
     * @param {number} frame Frame number.
     * @returns {number} Minimum distance to an edge of the shape.
     */
    distance(mousePos, frame) {
        const pos = this._interpolatePosition(frame);
        if (pos.outside) {
            return Number.MAX_SAFE_INTEGER;
        }

        const corners = PolyShapeModel.convertStringToNumberArray(pos.points);
        const { x, y } = mousePos;
        let minDistance = Number.MAX_SAFE_INTEGER;

        for (let i = 0; i < corners.length; i++) {
            const c1 = corners[i];
            const c2 = corners[i + 1] || corners[0];

            // perpendicular from point to straight length
            const distance = Math.abs((c2.y - c1.y) * x - (c2.x - c1.x) * y + c2.x * c1.y - c2.y * c1.x)
                / Math.sqrt((c2.y - c1.y) ** 2 + (c2.x - c1.x) ** 2);

            // check if perpendicular belongs to the straight segment
            const a = (c1.x - x) ** 2 + (c1.y - y) ** 2;
            const b = (c2.x - c1.x) ** 2 + (c2.y - c1.y) ** 2;
            const c = (c2.x - x) ** 2 + (c2.y - y) ** 2;
            if (distance < minDistance && (a + b - c) >= 0 && (c + b - a) >= 0) {
                minDistance = distance;
            }
        }

        return minDistance;
    }

    set draggable(value) {
        this._draggable = value;
        this.notify('draggable');
    }

    get draggable() {
        return this._draggable;
    }

    /**
     * See BoxModel's implementation comment.
     *
     * @param {ShapeModel} shape Model of the shape to be checked.
     * @returns {boolean} Whether shape is adjacent to this or not.
     */
    isAdjacentTo(shape) {
        if (!(shape instanceof PolygonModel) || this.frame !== shape.frame) {
            return false;
        }

        const thisCorners = PolyShapeModel.convertStringToNumberArray(this._positions[this.frame].points);
        const shapeCorners = PolyShapeModel.convertStringToNumberArray(shape._positions[shape.frame].points);

        for (const thisCorner of thisCorners) {
            for (const shapeCorner of shapeCorners) {
                if (isAdjacent(thisCorner, shapeCorner)) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * See BoxModel's implementation comment.
     *
     * @param {Point} point Point to be checked.
     * @returns {number} Index of corner adjacent to point, -1 if none is.
     */
    indexOfCornerAdjacentTo(point) {
        const corners = PolyShapeModel.convertStringToNumberArray(this._positions[this.frame].points);
        for (let i = 0; i < corners.length; ++i) {
            if (isAdjacent(corners[i], point)) {
                return i;
            }
        }
        return -1;
    }
}

/** ****************************** SHAPE CONTROLLERS  ******************************* */

class ShapeController {
    /**
     * @param {ShapeModel}
     */
    constructor(shapeModel) {
        this._model = shapeModel;
    }

    /**
     * @param {number} frame
     * @param {Object} position
     */
    updatePosition(frame, position) {
        this._model.updatePosition(frame, position);
    }

    updateAttribute(frame, attrId, value) {
        this._model.updateAttribute(frame, attrId, value);
    }

    interpolate(frame) {
        return this._model.interpolate(frame);
    }

    changeLabel(labelId) {
        this._model.changeLabel(labelId);
    }

    remove(e) {
        if (!window.cvat.mode) {
            if (!this._model.lock || e.shiftKey) {
                this._model.remove();
            }
        }
    }

    isKeyFrame(frame) {
        return this._model.isKeyFrame(frame);
    }

    switchOccluded() {
        this._model.switchOccluded(window.cvat.player.frames.current);
    }

    switchOutside() {
        this._model.switchOutside(window.cvat.player.frames.current);
    }

    switchKeyFrame() {
        this._model.switchKeyFrame(window.cvat.player.frames.current);
    }

    prevKeyFrame() {
        const frame = this._model.prevKeyFrame();
        if (Number.isInteger(frame)) {
            $('#frameNumber').prop('value', frame).trigger('change');
        }
    }

    nextKeyFrame() {
        const frame = this._model.nextKeyFrame();
        if (Number.isInteger(frame)) {
            $('#frameNumber').prop('value', frame).trigger('change');
        }
    }

    initKeyFrame() {
        const frame = this._model.initKeyFrame();
        $('#frameNumber').prop('value', frame).trigger('change');
    }

    switchLock() {
        this._model.switchLock();
    }

    switchHide() {
        this._model.switchHide();
    }

    click() {
        this._model.click();
    }

    /**
     * @returns {ShapeModel}
     */
    model() {
        return this._model;
    }

    get id() {
        return this._model.id;
    }

    get label() {
        return this._model.label;
    }

    get type() {
        return this._model.type;
    }

    get lock() {
        return this._model.lock;
    }

    get merge() {
        return this._model.merge;
    }

    get hiddenShape() {
        return this._model.hiddenShape;
    }

    get hiddenText() {
        return this._model.hiddenText;
    }

    get color() {
        return this._model.color;
    }

    set active(value) {
        this._model.active = value;
    }
}

class BoxController extends ShapeController {
    constructor(boxModel) {
        super(boxModel);
    }
}

class PolyShapeController extends ShapeController {
    constructor(polyShapeModel) {
        super(polyShapeModel);
    }
}

class PointsController extends PolyShapeController {
    constructor(pointsModel) {
        super(pointsModel);
    }
}

class PolylineController extends PolyShapeController {
    constructor(polylineModel) {
        super(polylineModel);
    }
}

class PolygonController extends PolyShapeController {
    constructor(polygonModel) {
        super(polygonModel);
    }

    set draggable(value) {
        this._model.draggable = value;
    }

    get draggable() {
        return this._model.draggable;
    }
}

/** ****************************** SHAPE VIEWS  ******************************* */
class ShapeView extends Listener {
    /**
     * @param {ShapeModel} shapeModel
     * @param {ShapeController} shapeController
     * @param {SVG.Element} svgScene
     * @param {jQuery} menusScene
     * @param {SVG.Element} textsScene
     */
    constructor(shapeModel, shapeController, svgScene, menusScene, textsScene) {
        super('onShapeViewUpdate', () => this);
        this._uis = {
            menu: null,
            attributes: {},
            buttons: {},
            changelabel: null,
            shape: null,
            text: null,
        };

        this._scenes = {
            svg: svgScene,
            menus: menusScene,
            texts: textsScene,
        };

        this._appearance = {
            colors: shapeModel.color,
            fillOpacity: 0,
            selectedFillOpacity: 0.2,
        };

        this._flags = {
            editable: false,
            selected: false,
            dragging: false,
            resizing: false,
        };

        this._controller = shapeController;
        this._updateReason = null;

        this._shapeContextMenu = $('#shapeContextMenu');
        this._pointContextMenu = $('#pointContextMenu');

        this._rightBorderFrame = $('#playerFrame')[0].offsetWidth;
        this._bottomBorderFrame = $('#playerFrame')[0].offsetHeight;

        shapeModel.subscribe(this);
    }

    /**
     * Make THIS shape (not all shapes) editable (resize, drag,...) by showing draggable corners.
     * This function is called whenever the shape is selected, not a one-time setup,
     * as it actually shows the corners, instead of just setting callbacks.
     */
    _makeEditable() {
        if (this._uis.shape && this._uis.shape.node.parentElement && !this._flags.editable) {
            const events = {
                drag: null,
                resize: null,
            };

            this._uis.shape.front();
            if (!this._controller.lock) {
                // Setup drag events
                this._uis.shape
                    .draggable()
                    .on('dragstart', () => {
                        events.drag = Logger.addContinuedEvent(Logger.EventType.dragObject);
                        this._flags.dragging = true;
                        blurAllElements();
                        this._hideShapeText();
                        this.notify('drag');
                    })
                    .on('dragend', (e) => {
                        const p1 = e.detail.handler.startPoints.point;
                        const p2 = e.detail.p;
                        events.drag.close();
                        events.drag = null;
                        this._flags.dragging = false;
                        if ((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2 > 1) {
                            const frame = window.cvat.player.frames.current;
                            this._controller.updatePosition(frame, this._buildPosition());
                        }
                        this._showShapeText();
                        this.notify('drag');
                    });

                // Check if resize actually happens or not to avoid redundant data updates.
                let objWasResized = false;

                // Setup resize events
                this._uis.shape
                    .selectize({
                        classRect: 'shapeSelect',
                        rotationPoint: false,
                        pointSize: POINT_RADIUS * 2 / window.cvat.player.geometry.scale,
                        deepSelect: true,
                    })
                    .resize({
                        snapToGrid: 0.1,
                    })
                    .on('resizestart', event => {
                        // Corner's mousedown callback.
                        objWasResized = false;
                        this._flags.resizing = true;
                        events.resize = Logger.addContinuedEvent(Logger.EventType.resizeObject);

                        blurAllElements();
                        this._hideShapeText();

                        this.resizeDetail = event.detail;    // Other ugly options: 1. Get ShapeCollectionView from listeners. 2. Add another on('...') in ShapeCollectionView.
                        this.notify('resizestart');
                    })
                    .on('resizing', event => {
                        // Corner's mousemove callback
                        objWasResized = true;
                        this.resizeDetail = event.detail;
                        this.notify('resizing');
                    })
                    .on('resizedone', () => {
                        // Corner's mouseup callback.
                        events.resize.close();
                        events.resize = null;
                        this._flags.resizing = false;
                        this.resizeDetail = { objWasResized };
                        if (objWasResized) {
                            const frame = window.cvat.player.frames.current;
                            this._controller.updatePosition(frame, this._buildPosition());
                            objWasResized = false;
                        }

                        this._showShapeText();

                        this.notify('resizedone');
                    });

                const centers = ['t', 'r', 'b', 'l'];
                const corners = ['lt', 'rt', 'rb', 'lb'];
                const controlPoints = {};
                for (let i = 0; i < 4; ++i) {
                    controlPoints[centers[i]] = $(`.svg_select_points_${centers[i]}`);
                    controlPoints[corners[i]] = $(`.svg_select_points_${corners[i]}`);
                }

                const angle = window.cvat.player.rotation;
                const offset = angle / 90 < 0 ? angle / 90 + centers.length : angle / 90;

                for (let i = 0; i < 4; ++i) {
                    controlPoints[centers[i]]
                        .removeClass(`svg_select_points_${centers[i]}`)
                        .addClass(`svg_select_points_${centers[(i + offset) % centers.length]}`);
                    controlPoints[corners[i]]
                        .removeClass(`svg_select_points_${corners[i]}`)
                        .addClass(`svg_select_points_${corners[(i + offset) % corners.length]}`);
                }

                this._updateColorForDots();
                const self = this;
                $('.svg_select_points').each(function () {
                    $(this)
                        .on('mouseover', () => {
                            this.instance.attr('stroke-width', STROKE_WIDTH * 2 / window.cvat.player.geometry.scale);
                        })
                        .on('mouseout', () => {
                            this.instance.attr('stroke-width', STROKE_WIDTH / window.cvat.player.geometry.scale);
                        })
                        .on('mousedown', () => {
                            self._positionateMenus();
                        });
                });

                this._flags.editable = true;
            }

            // Setup context menu
            this._uis.shape.on('mousedown.contextMenu', (e) => {
                if (e.which === 1) {
                    $('.custom-menu').hide(100);
                }
                if (e.which === 3) {
                    e.stopPropagation();
                }
            });

            this._uis.shape.on('contextmenu.contextMenu', (e) => {
                $('.custom-menu').hide(100);

                const type = this._controller.type.split('_');
                if (type[0] === 'interpolation') {
                    this._shapeContextMenu.find('.interpolationItem').removeClass('hidden');
                } else {
                    this._shapeContextMenu.find('.interpolationItem').addClass('hidden');
                }

                const dragPolyItem = this._shapeContextMenu.find('.polygonItem[action="drag_polygon"]');
                const { draggable } = this._controller;
                if (type[1] === 'polygon') {
                    dragPolyItem.removeClass('hidden');
                    if (draggable) {
                        dragPolyItem.text('Disable Dragging');
                    } else {
                        dragPolyItem.text('Enable Dragging');
                    }
                } else {
                    dragPolyItem.addClass('hidden');
                }

                const resetPerpectiveItem = this._shapeContextMenu.find('.cuboidItem[action="reset_perspective"]');
                const switchOrientationItem = this._shapeContextMenu.find('.cuboidItem[action="switch_orientation"]');
                if (type[1] === 'cuboid') {
                    resetPerpectiveItem.removeClass('hidden');
                    switchOrientationItem.removeClass('hidden');
                } else {
                    resetPerpectiveItem.addClass('hidden');
                    switchOrientationItem.addClass('hidden');
                }

                const splitBoxItem = this._shapeContextMenu.find('li[action^="split_"]');
                if (['box', 'polygon'].includes(type[1])) {
                    splitBoxItem.show();
                } else {
                    splitBoxItem.hide();
                }

                this._shapeContextMenu.finish().show(100);
                const x = Math.min(e.pageX, this._rightBorderFrame - this._shapeContextMenu[0].scrollWidth);
                const y = Math.min(e.pageY, this._bottomBorderFrame - this._shapeContextMenu[0].scrollHeight);
                this._shapeContextMenu.offset({
                    left: x,
                    top: y,
                });

                e.preventDefault();
                e.stopPropagation();
            });
        }
    }

    /**
     * The reverse of _makeEditable().
     * This function is called whenever the shape is deselected.
     */
    _makeNotEditable() {
        if (this._uis.shape && this._flags.editable) {
            this._uis.shape
                .draggable(false)
                .selectize(false, {
                    deepSelect: true,
                })
                .resize(false);    // Why? Shouldn't it be 'stop' instead of false?

            if (this._flags.resizing) {
                this._flags.resizing = false;
                this.notify('resize');
            }

            if (this._flags.dragging) {
                this._flags.dragging = false;
                this.notify('drag');
            }

            this._uis.shape
                .off('dragstart')
                .off('dragend')
                .off('resizestart')
                .off('resizing')
                .off('resizedone')
                .off('contextmenu.contextMenu')
                .off('mousedown.contextMenu');

            this._flags.editable = false;
        }

        $('.custom-menu').hide(100);
    }

    /**
     * Add shape highlighting when select.
     * In fact, most of the highlighting code is inside _makeEditable().
     */
    _select() {
        if (this._uis.shape && this._uis.shape.node.parentElement) {
            this._uis.shape.addClass('selectedShape');
            this._uis.shape.attr({
                'fill-opacity': this._appearance.selectedFillOpacity,
            });
        }

        if (this._uis.menu) {
            this._uis.menu.addClass('highlightedUI');
        }
    }

    /**
     * The reverse of _select().
     */
    _deselect() {
        if (this._uis.shape) {
            this._uis.shape.removeClass('selectedShape');

            if (this._appearance.whiteOpacity) {
                this._uis.shape.attr({
                    'stroke-opacity': this._appearance.fillOpacity,
                    'stroke-width': 1 / window.cvat.player.geometry.scale,
                    'fill-opacity': this._appearance.fillOpacity,
                });
            } else {
                this._uis.shape.attr({
                    'stroke-opacity': 1,
                    'stroke-width': STROKE_WIDTH / window.cvat.player.geometry.scale,
                    'fill-opacity': this._appearance.fillOpacity,
                });
            }
        }

        if (this._uis.menu) {
            this._uis.menu.removeClass('highlightedUI');
        }
    }

    _removeShapeUI() {
        if (this._uis.shape) {
            this._uis.shape.remove();
            SVG.off(this._uis.shape.node);
            this._uis.shape = null;
        }
    }

    _removeShapeText() {
        if (this._uis.text) {
            this._uis.text.remove();
            SVG.off(this._uis.text.node);
            this._uis.text = null;
        }
    }

    _removeMenu() {
        if (this._uis.menu) {
            this._uis.menu.remove();
            this._uis.menu = null;
        }
    }

    _hideShapeText() {
        if (this._uis.text && this._uis.text.node.parentElement) {
            this._scenes.texts.node.removeChild(this._uis.text.node);
        }
    }

    _showShapeText() {
        if (!this._uis.text) {
            const frame = window.cvat.player.frames.current;
            this._drawShapeText(this._controller.interpolate(frame).attributes);
        } else if (!this._uis.text.node.parentElement) {
            this._scenes.texts.node.appendChild(this._uis.text.node);
        }

        this.updateShapeTextPosition();
    }

    _drawShapeText(attributes) {
        this._removeShapeText();
        if (this._uis.shape) {
            const { id } = this._controller;
            const label = ShapeView.labels()[this._controller.label];

            this._uis.text = this._scenes.texts.text((add) => {
                add.tspan(`${label.normalize()} ${id}`).style('text-transform', 'uppercase');
                for (const attrId in attributes) {
                    const value = attributes[attrId].value != AAMUndefinedKeyword
                        ? attributes[attrId].value : '';
                    const { name } = attributes[attrId];
                    add.tspan(`${name}: ${value}`).attr({ dy: '1em', x: 0, attrId });
                }
            }).move(0, 0).addClass('shapeText bold');
        }
    }

    _highlightAttribute(attrId) {
        if (this._uis.text) {
            for (const tspan of this._uis.text.lines().members) {
                if (+tspan.attr('attrId') == +attrId) {
                    tspan.fill('red');
                } else tspan.fill('white');
            }
        }
    }

    _setupOccludedUI(occluded) {
        if (this._uis.shape) {
            if (occluded) {
                this._uis.shape.node.classList.add('occludedShape');
            } else {
                this._uis.shape.node.classList.remove('occludedShape');
            }
        }
    }

    _setupLockedUI(locked) {
        if (this._uis.changelabel) {
            this._uis.changelabel.disabled = locked;
        }

        if ('occlude' in this._uis.buttons) {
            this._uis.buttons.occlude.disabled = locked;
        }

        if ('keyframe' in this._uis.buttons) {
            this._uis.buttons.keyframe.disabled = locked;
        }

        if ('outside' in this._uis.buttons) {
            this._uis.buttons.outside.disabled = locked;
        }

        for (const attrId in this._uis.attributes) {
            const attrInfo = window.cvat.labelsInfo.attrInfo(attrId);
            const attribute = this._uis.attributes[attrId];
            if (attrInfo.type === 'radio') {
                for (const attrPart of attribute) {
                    attrPart.disabled = locked;
                }
            } else {
                attribute.disabled = locked;
            }
        }
    }

    _setupMergeView(merge) {
        if (this._uis.shape) {
            if (merge) {
                this._uis.shape.addClass('mergeShape');
            } else {
                this._uis.shape.removeClass('mergeShape');
            }
        }
    }

    _setupGroupView(group) {
        if (this._uis.shape) {
            if (group) {
                this._uis.shape.addClass('groupShape');
            } else {
                this._uis.shape.removeClass('groupShape');
            }
        }
    }

    _positionateMenus() {
        if (this._uis.menu) {
            this._scenes.menus.scrollTop(0);
            this._scenes.menus.scrollTop(this._uis.menu.offset().top - this._scenes.menus.offset().top);
        }
    }

    _drawMenu(outside) {
        const { id } = this._controller;
        const label = ShapeView.labels()[this._controller.label];
        const { type } = this._controller;
        const shortkeys = ShapeView.shortkeys();

        // Use native java script code because draw UI is performance bottleneck
        const UI = document.createElement('div');
        const titleBlock = makeTitleBlock.call(this, id, label, type, shortkeys);
        const buttonBlock = makeButtonBlock.call(this, type, outside, shortkeys);
        UI.appendChild(titleBlock);
        UI.appendChild(buttonBlock);

        if (!outside) {
            const changeLabelBlock = makeChangeLabelBlock.call(this, shortkeys);
            const attributesBlock = makeAttributesBlock.call(this, id);
            if (changeLabelBlock) {
                UI.appendChild(changeLabelBlock);
            }

            if (attributesBlock) {
                UI.appendChild(attributesBlock);
            }
        }

        UI.classList.add('uiElement', 'regular');
        UI.style.backgroundColor = this._controller.color.ui;

        this._uis.menu = $(UI);
        this._scenes.menus.prepend(this._uis.menu);

        function makeTitleBlock(id, label, type, shortkeys) {
            const title = document.createElement('div');

            const titleText = document.createElement('label');
            titleText.innerText = `${label} ${id} `
                + `[${type.split('_')[1]}, ${type.split('_')[0]}]`;
            title.appendChild(titleText);
            title.classList.add('bold');
            title.style.marginRight = '32px';

            const deleteButton = document.createElement('a');
            deleteButton.classList.add('close');
            this._uis.buttons.delete = deleteButton;
            deleteButton.setAttribute('title', `
                ${shortkeys.delete_shape.view_value} - ${shortkeys.delete_shape.description}`);

            title.appendChild(titleText);
            title.appendChild(deleteButton);

            return title;
        }

        function makeButtonBlock(type, outside, shortkeys) {
            const buttonBlock = document.createElement('div');
            buttonBlock.appendChild(document.createElement('hr'));

            if (!outside) {
                const annotationCenter = document.createElement('center');

                const lockButton = document.createElement('button');
                lockButton.classList.add('graphicButton', 'lockButton');
                lockButton.setAttribute('title', `
                    ${shortkeys.switch_lock_property.view_value} - ${shortkeys.switch_lock_property.description}` + '\n'
                    + `${shortkeys.switch_all_lock_property.view_value} - ${shortkeys.switch_all_lock_property.description}`);

                const occludedButton = document.createElement('button');
                occludedButton.classList.add('graphicButton', 'occludedButton');
                occludedButton.setAttribute('title', `
                    ${shortkeys.switch_occluded_property.view_value} - ${shortkeys.switch_occluded_property.description}`);

                const copyButton = document.createElement('button');
                copyButton.classList.add('graphicButton', 'copyButton');
                copyButton.setAttribute('title', `
                    ${shortkeys.copy_shape.view_value} - ${shortkeys.copy_shape.description}` + '\n'
                    + `${shortkeys.switch_paste.view_value} - ${shortkeys.switch_paste.description}`);

                const propagateButton = document.createElement('button');
                propagateButton.classList.add('graphicButton', 'propagateButton');
                propagateButton.setAttribute('title', `
                    ${shortkeys.propagate_shape.view_value} - ${shortkeys.propagate_shape.description}`);

                const hiddenButton = document.createElement('button');
                hiddenButton.classList.add('graphicButton', 'hiddenButton');
                hiddenButton.setAttribute('title', `
                    ${shortkeys.switch_hide_mode.view_value} - ${shortkeys.switch_hide_mode.description}` + '\n'
                    + `${shortkeys.switch_all_hide_mode.view_value} - ${shortkeys.switch_all_hide_mode.description}`);

                annotationCenter.appendChild(lockButton);
                annotationCenter.appendChild(occludedButton);
                annotationCenter.appendChild(copyButton);
                annotationCenter.appendChild(propagateButton);
                annotationCenter.appendChild(hiddenButton);
                buttonBlock.appendChild(annotationCenter);

                this._uis.buttons.lock = lockButton;
                this._uis.buttons.occlude = occludedButton;
                this._uis.buttons.hide = hiddenButton;
                this._uis.buttons.copy = copyButton;
                this._uis.buttons.propagate = propagateButton;
            }

            if (type.split('_')[0] == 'interpolation') {
                const interpolationCenter = document.createElement('center');

                const outsideButton = document.createElement('button');
                outsideButton.classList.add('graphicButton', 'outsideButton');

                const keyframeButton = document.createElement('button');
                keyframeButton.classList.add('graphicButton', 'keyFrameButton');

                interpolationCenter.appendChild(outsideButton);
                interpolationCenter.appendChild(keyframeButton);

                this._uis.buttons.outside = outsideButton;
                this._uis.buttons.keyframe = keyframeButton;

                const prevKeyFrameButton = document.createElement('button');
                prevKeyFrameButton.classList.add('graphicButton', 'prevKeyFrameButton');
                prevKeyFrameButton.setAttribute('title', `
                    ${shortkeys.prev_key_frame.view_value} - ${shortkeys.prev_key_frame.description}`);

                const initKeyFrameButton = document.createElement('button');
                initKeyFrameButton.classList.add('graphicButton', 'initKeyFrameButton');

                const nextKeyFrameButton = document.createElement('button');
                nextKeyFrameButton.classList.add('graphicButton', 'nextKeyFrameButton');
                nextKeyFrameButton.setAttribute('title', `
                    ${shortkeys.next_key_frame.view_value} - ${shortkeys.next_key_frame.description}`);

                interpolationCenter.appendChild(prevKeyFrameButton);
                interpolationCenter.appendChild(initKeyFrameButton);
                interpolationCenter.appendChild(nextKeyFrameButton);
                buttonBlock.appendChild(interpolationCenter);

                this._uis.buttons.prevKeyFrame = prevKeyFrameButton;
                this._uis.buttons.initKeyFrame = initKeyFrameButton;
                this._uis.buttons.nextKeyFrame = nextKeyFrameButton;
            }

            return buttonBlock;
        }

        function makeChangeLabelBlock(shortkeys) {
            const labels = ShapeView.labels();
            if (Object.keys(labels).length > 1) {
                const block = document.createElement('div');

                const htmlLabel = document.createElement('label');
                htmlLabel.classList.add('semiBold');
                htmlLabel.innerText = 'Label: ';

                const select = document.createElement('select');
                select.classList.add('regular');
                for (const labelId in labels) {
                    const option = document.createElement('option');
                    option.setAttribute('value', labelId);
                    option.innerText = `${labels[labelId].normalize()}`;
                    select.add(option);
                }

                select.setAttribute('title', `
                    ${shortkeys.change_shape_label.view_value} - ${shortkeys.change_shape_label.description}`);

                block.appendChild(htmlLabel);
                block.appendChild(select);

                this._uis.changelabel = select;
                return block;
            }

            return null;
        }

        function makeAttributesBlock(objectId) {
            const attributes = window.cvat.labelsInfo.labelAttributes(this._controller.label);

            if (Object.keys(attributes).length) {
                const block = document.createElement('div');
                const htmlLabel = document.createElement('label');
                htmlLabel.classList.add('semiBold');
                htmlLabel.innerHTML = 'Attributes <br>';

                block.appendChild(htmlLabel);

                // Make it beautiful. Group attributes by type:
                const attrByType = {};
                for (const attrId in attributes) {
                    const attrInfo = window.cvat.labelsInfo.attrInfo(attrId);
                    attrByType[attrInfo.type] = attrByType[attrInfo.type] || [];
                    attrByType[attrInfo.type].push(attrId);
                }

                const radios = attrByType.radio || [];
                const selects = attrByType.select || [];
                const texts = attrByType.text || [];
                const numbers = attrByType.number || [];
                const checkboxes = attrByType.checkbox || [];

                selects.sort((attrId_1, attrId_2) => attributes[attrId_1].normalize().length - attributes[attrId_2].normalize().length);
                texts.sort((attrId_1, attrId_2) => attributes[attrId_1].normalize().length - attributes[attrId_2].normalize().length);
                numbers.sort((attrId_1, attrId_2) => attributes[attrId_1].normalize().length - attributes[attrId_2].normalize().length);
                checkboxes.sort((attrId_1, attrId_2) => attributes[attrId_1].normalize().length - attributes[attrId_2].normalize().length);

                for (const attrId of [...radios, ...selects, ...texts, ...numbers, ...checkboxes]) {
                    const attrInfo = window.cvat.labelsInfo.attrInfo(attrId);
                    const htmlAttribute = makeAttribute.call(this, attrInfo, attrId, objectId);
                    htmlAttribute.classList.add('uiAttr');

                    block.appendChild(htmlAttribute);
                }

                return block;
            }

            return null;
        }

        function makeAttribute(attrInfo, attrId, objectId) {
            switch (attrInfo.type) {
            case 'checkbox':
                return makeCheckboxAttr.call(this, attrInfo, attrId, objectId);
            case 'select':
                return makeSelectAttr.call(this, attrInfo, attrId, objectId);
            case 'radio':
                return makeRadioAttr.call(this, attrInfo, attrId, objectId);
            case 'number':
                return makeNumberAttr.call(this, attrInfo, attrId, objectId);
            case 'text':
                return makeTextAttr.call(this, attrInfo, attrId, objectId);
            default:
                throw Error(`Unknown attribute type found: ${attrInfo.type}`);
            }
        }

        function makeCheckboxAttr(attrInfo, attrId, objectId) {
            const block = document.createElement('div');

            const checkbox = document.createElement('input');
            checkbox.setAttribute('type', 'checkbox');
            checkbox.setAttribute('id', `attr_${attrId}_of_${objectId}`);
            checkbox.setAttribute('attrId', attrId);

            const label = document.createElement('label');
            label.setAttribute('for', `attr_${attrId}_of_${objectId}`);
            label.innerText = `${attrInfo.name.normalize()}`;

            block.appendChild(checkbox);
            block.appendChild(label);

            this._uis.attributes[attrId] = checkbox;
            return block;
        }

        function makeSelectAttr(attrInfo, attrId) {
            const block = document.createElement('div');

            const select = document.createElement('select');
            select.setAttribute('attrId', attrId);
            select.classList.add('regular', 'selectAttr');
            for (const value of attrInfo.values) {
                const option = document.createElement('option');
                option.setAttribute('value', value);
                if (value === AAMUndefinedKeyword) {
                    option.innerText = '';
                } else {
                    option.innerText = value.normalize();
                }

                select.add(option);
            }

            const label = document.createElement('label');
            label.innerText = `${attrInfo.name.normalize()}: `;

            block.appendChild(label);
            block.appendChild(select);

            this._uis.attributes[attrId] = select;
            return block;
        }

        function makeRadioAttr(attrInfo, attrId, objectId) {
            const block = document.createElement('fieldset');

            const legend = document.createElement('legend');
            legend.innerText = `${attrInfo.name.normalize()}`;
            block.appendChild(legend);

            this._uis.attributes[attrId] = [];
            for (let idx = 0; idx < attrInfo.values.length; idx++) {
                const value = attrInfo.values[idx];
                const wrapper = document.createElement('div');

                const label = document.createElement('label');
                label.setAttribute('for', `attr_${attrId}_of_${objectId}_${idx}`);

                if (value === AAMUndefinedKeyword) {
                    label.innerText = '';
                } else {
                    label.innerText = value.normalize();
                }

                const radio = document.createElement('input');
                radio.setAttribute('type', 'radio');
                radio.setAttribute('name', `attr_${attrId}_of_${objectId}`);
                radio.setAttribute('attrId', attrId);
                radio.setAttribute('value', value);
                radio.setAttribute('id', `attr_${attrId}_of_${objectId}_${idx}`);

                wrapper.appendChild(radio);
                wrapper.appendChild(label);
                block.appendChild(wrapper);

                this._uis.attributes[attrId].push(radio);
            }

            return block;
        }

        function makeNumberAttr(attrInfo, attrId) {
            const [min, max, step] = attrInfo.values;
            const block = document.createElement('div');

            const label = document.createElement('label');
            label.innerText = `${attrInfo.name.normalize()}: `;

            const number = document.createElement('input');
            number.setAttribute('type', 'number');
            number.setAttribute('step', `${step}`);
            number.setAttribute('min', `${min}`);
            number.setAttribute('max', `${max}`);
            number.classList.add('regular', 'numberAttr');

            const stopProp = function (e) {
                const key = e.keyCode;
                const serviceKeys = [37, 38, 39, 40, 13, 16, 9, 109];
                if (serviceKeys.includes(key)) {
                    e.preventDefault();
                    return;
                }
                e.stopPropagation();
            };
            number.onkeydown = stopProp;

            block.appendChild(label);
            block.appendChild(number);

            this._uis.attributes[attrId] = number;
            return block;
        }

        function makeTextAttr(attrInfo, attrId) {
            const block = document.createElement('div');

            const label = document.createElement('label');
            label.innerText = `${attrInfo.name.normalize()}: `;

            const text = document.createElement('input');
            text.setAttribute('type', 'text');
            text.classList.add('regular', 'textAttr');

            const stopProp = function (e) {
                const key = e.keyCode;
                const serviceKeys = [37, 38, 39, 40, 13, 16, 9, 109];
                if (serviceKeys.includes(key)) {
                    e.preventDefault();
                    return;
                }
                e.stopPropagation();
            };
            text.onkeydown = stopProp;

            block.appendChild(label);
            block.appendChild(text);

            this._uis.attributes[attrId] = text;
            return block;
        }
    }

    _drawShapeUI() {
        this._uis.shape.on('click', () => {
            this._positionateMenus();
            this._controller.click();
        });

        // Save view in order to have access to view in shapeGrouper (no such other methods to get it)
        this._uis.shape.node.cvatView = this;
    }

    _updateButtonsBlock(position) {
        const { occluded } = position;
        const { outside } = position;
        const { lock } = this._controller;
        const { hiddenShape } = this._controller;
        const { hiddenText } = this._controller;
        const keyFrame = this._controller.isKeyFrame(window.cvat.player.frames.current);

        if ('occlude' in this._uis.buttons) {
            if (occluded) {
                this._uis.buttons.occlude.classList.add('occluded');
            } else {
                this._uis.buttons.occlude.classList.remove('occluded');
            }
            this._uis.buttons.occlude.disabled = lock;
        }

        if ('lock' in this._uis.buttons) {
            if (lock) {
                this._uis.buttons.lock.classList.add('locked');
            } else {
                this._uis.buttons.lock.classList.remove('locked');
            }
        }

        if ('hide' in this._uis.buttons) {
            if (hiddenShape) {
                this._uis.buttons.hide.classList.remove('hiddenText');
                this._uis.buttons.hide.classList.add('hiddenShape');
            } else if (hiddenText) {
                this._uis.buttons.hide.classList.add('hiddenText');
                this._uis.buttons.hide.classList.remove('hiddenShape');
            } else {
                this._uis.buttons.hide.classList.remove('hiddenText', 'hiddenShape');
            }
        }

        if ('outside' in this._uis.buttons) {
            if (outside) {
                this._uis.buttons.outside.classList.add('outside');
            } else {
                this._uis.buttons.outside.classList.remove('outside');
            }
        }

        if ('keyframe' in this._uis.buttons) {
            if (keyFrame) {
                this._uis.buttons.keyframe.classList.add('keyFrame');
            } else {
                this._uis.buttons.keyframe.classList.remove('keyFrame');
            }
        }
    }

    _updateMenuContent(interpolation) {
        const { attributes } = interpolation;
        for (const attrId in attributes) {
            if (attrId in this._uis.attributes) {
                const attrInfo = window.cvat.labelsInfo.attrInfo(attrId);
                if (attrInfo.type === 'radio') {
                    const idx = attrInfo.values.indexOf(attributes[attrId].value);
                    this._uis.attributes[attrId][idx].checked = true;
                } else if (attrInfo.type === 'checkbox') {
                    this._uis.attributes[attrId].checked = attributes[attrId].value;
                } else {
                    this._uis.attributes[attrId].value = attributes[attrId].value;
                }
            }
        }

        if (this._uis.changelabel) {
            this._uis.changelabel.value = this._controller.label;
        }

        this._updateButtonsBlock(interpolation.position);
    }

    _activateMenu() {
        if ('occlude' in this._uis.buttons) {
            this._uis.buttons.occlude.onclick = () => {
                this._controller.switchOccluded();
            };
        }

        if ('lock' in this._uis.buttons) {
            this._uis.buttons.lock.onclick = () => {
                this._controller.switchLock();
            };
        }

        if ('hide' in this._uis.buttons) {
            this._uis.buttons.hide.onclick = () => {
                this._controller.switchHide();
            };
        }

        if ('copy' in this._uis.buttons) {
            this._uis.buttons.copy.onclick = () => {
                Mousetrap.trigger(window.cvat.config.shortkeys.copy_shape.value, 'keydown');
            };
        }

        if ('propagate' in this._uis.buttons) {
            this._uis.buttons.propagate.onclick = () => {
                Mousetrap.trigger(window.cvat.config.shortkeys.propagate_shape.value, 'keydown');
            };
        }

        if ('delete' in this._uis.buttons) {
            this._uis.buttons.delete.onclick = (e) => this._controller.remove(e);
        }

        if ('outside' in this._uis.buttons) {
            this._uis.buttons.outside.onclick = () => {
                this._controller.switchOutside();
            };
        }

        if ('keyframe' in this._uis.buttons) {
            this._uis.buttons.keyframe.onclick = () => {
                this._controller.switchKeyFrame();
            };
        }

        if ('prevKeyFrame' in this._uis.buttons) {
            this._uis.buttons.prevKeyFrame.onclick = () => this._controller.prevKeyFrame();
        }

        if ('nextKeyFrame' in this._uis.buttons) {
            this._uis.buttons.nextKeyFrame.onclick = () => this._controller.nextKeyFrame();
        }

        if ('initKeyFrame' in this._uis.buttons) {
            this._uis.buttons.initKeyFrame.onclick = () => this._controller.initKeyFrame();
        }

        if (this._uis.changelabel) {
            this._uis.changelabel.onchange = (e) => this._controller.changeLabel(e.target.value);
        }

        this._uis.menu.on('mouseenter mousedown', (e) => {
            if (!window.cvat.mode && !e.ctrlKey) {
                this._controller.active = true;
            }
        });

        for (const attrId in this._uis.attributes) {
            const attrInfo = window.cvat.labelsInfo.attrInfo(attrId);
            switch (attrInfo.type) {
            case 'radio':
                for (let idx = 0; idx < this._uis.attributes[attrId].length; idx++) {
                    this._uis.attributes[attrId][idx].onchange = function (e) {
                        this._controller.updateAttribute(window.cvat.player.frames.current, attrId, e.target.value);
                    }.bind(this);
                }
                break;
            case 'checkbox':
                this._uis.attributes[attrId].onchange = function (e) {
                    this._controller.updateAttribute(window.cvat.player.frames.current, attrId, e.target.checked);
                }.bind(this);
                break;
            case 'number':
                this._uis.attributes[attrId].onchange = function (e) {
                    const value = Math.clamp(+e.target.value, +e.target.min, +e.target.max);
                    e.target.value = value;
                    this._controller.updateAttribute(window.cvat.player.frames.current, attrId, value);
                }.bind(this);
                break;
            default:
                this._uis.attributes[attrId].onchange = function (e) {
                    this._controller.updateAttribute(window.cvat.player.frames.current, attrId, e.target.value);
                }.bind(this);
            }
        }
    }

    _updateColorForDots() {
        const color = this._appearance.fill || this._appearance.colors.shape;
        const scaledStroke = SELECT_POINT_STROKE_WIDTH / window.cvat.player.geometry.scale;
        $('.svg_select_points').each(function () {
            this.instance.fill(color);
            this.instance.stroke('black');
            this.instance.attr('stroke-width', scaledStroke);
        });
    }

    /**
     * Notify listeners with reason.
     * The reason is temporary, as this_updateReason will be revert
     * back to the current one after notifying all the listeners.
     *
     * @param {string} newReason Reason to update.
     */
    notify(newReason) {
        const oldReason = this._updateReason;
        this._updateReason = newReason;
        try {
            Listener.prototype.notify.call(this);
        } finally {
            this._updateReason = oldReason;
        }
    }

    /**
     * Interface methods.
     *
     * @param {ShapeInFrame} interpolation Calculated shape information, ready to draw.
     */
    draw(interpolation) {
        const { outside } = interpolation.position;

        if (!outside) {
            if (!this._controller.hiddenShape) {
                this._drawShapeUI(interpolation.position);
                this._setupOccludedUI(interpolation.position.occluded);
                this._setupMergeView(this._controller.merge);
                if (!this._controller.hiddenText) {
                    this._showShapeText();
                }
            }
        }

        this._drawMenu(outside);
        this._updateMenuContent(interpolation);
        this._activateMenu();
        this._setupLockedUI(this._controller.lock);
    }

    erase() {
        this._removeShapeUI();
        this._removeShapeText();
        this._removeMenu();
        this._uis.attributes = {};
        this._uis.buttons = {};
        this._uis.changelabel = null;
    }

    updateShapeTextPosition() {
        if (this._uis.shape && this._uis.shape.node.parentElement) {
            const { scale } = window.cvat.player.geometry;
            if (this._appearance.whiteOpacity) {
                this._uis.shape.attr('stroke-width', 1 / scale);
            } else {
                this._uis.shape.attr('stroke-width', STROKE_WIDTH / scale);
            }

            if (this._uis.text && this._uis.text.node.parentElement) {
                const shapeBBox = window.cvat.translate.box.canvasToClient(this._scenes.svg.node, this._uis.shape.node.getBBox());
                const textBBox = this._uis.text.node.getBBox();

                let drawPoint = {
                    x: shapeBBox.x + shapeBBox.width + TEXT_MARGIN,
                    y: shapeBBox.y,
                };

                const textContentScale = 10;
                if ((drawPoint.x + textBBox.width * textContentScale) > this._rightBorderFrame) {
                    drawPoint = {
                        x: shapeBBox.x + TEXT_MARGIN,
                        y: shapeBBox.y,
                    };
                }

                const textPoint = window.cvat.translate.point.clientToCanvas(
                    this._scenes.texts.node,
                    drawPoint.x,
                    drawPoint.y,
                );

                this._uis.text.move(textPoint.x, textPoint.y);

                for (const tspan of this._uis.text.lines().members) {
                    tspan.attr('x', this._uis.text.attr('x'));
                }
            }
        }
    }

    /**
     * Callback to receive update from ShapeModel.
     *
     * @param {ShapeModel} model ShapeModel of this ShapeView.
     */
    onShapeUpdate(model) {
        const interpolation = model.interpolate(window.cvat.player.frames.current);
        const { activeAttribute } = model;
        const hiddenText = model.hiddenText && activeAttribute === null;
        const hiddenShape = model.hiddenShape && activeAttribute === null;

        if (this._flags.resizing || this._flags.dragging) {
            Logger.addEvent(Logger.EventType.debugInfo, {
                debugMessage: 'Object has been updated during resizing/dragging',
                updateReason: model.updateReason,
            });
        }

        this._makeNotEditable();
        this._deselect();
        if (hiddenText) {
            this._hideShapeText();
        }

        // Case with curly braces creates block scope, so multiple let/const of
        // the same variable is possible.
        switch (model.updateReason) {
        case 'activation':
            if (!model.active) {
                ShapeCollectionView.sortByZOrder();
            }
            break;
        case 'attributes':
            this._updateMenuContent(interpolation);
            setupHidden.call(this, hiddenShape, hiddenText,
                activeAttribute, model.active, interpolation);
            break;
        case 'merge':
            this._setupMergeView(model.merge);
            break;
        case 'groupping':
            this._setupGroupView(model.groupping);
            break;
        case 'lock': {
            const locked = model.lock;
            if (locked) {
                ShapeCollectionView.sortByZOrder();
            }

            this._setupLockedUI(locked);
            this._updateButtonsBlock(interpolation.position);
            this.notify('lock');
            break;
        }
        case 'occluded':
            this._setupOccludedUI(interpolation.position.occluded);
            this._updateButtonsBlock(interpolation.position);
            break;
        case 'hidden':
            setupHidden.call(this, hiddenShape, hiddenText,
                activeAttribute, model.active, interpolation);
            this._updateButtonsBlock(interpolation.position);
            this.notify('hidden');
            break;
        case 'remove':
            if (model.removed) {
                this.erase();
                this.notify('remove');
            }
            break;
        case 'position':
        case 'changelabel': {
            const idx = this._uis.menu.index();
            this._controller.model().unsubscribe(this);
            this.erase();
            this.draw(interpolation);
            this._controller.model().subscribe(this);
            this._uis.menu.detach();
            if (!idx) {
                this._uis.menu.prependTo(this._scenes.menus);
            } else {
                this._uis.menu.insertAfter(this._scenes.menus.find(`.uiElement:nth-child(${idx})`));
            }

            const colorByLabel = $('#colorByLabelRadio');
            if (colorByLabel.prop('checked')) {
                colorByLabel.trigger('change');
            }
            this.notify('changelabel');
            break;
        }
        case 'activeAttribute':
            setupHidden.call(this, hiddenShape, hiddenText,
                activeAttribute, model.active, interpolation);

            if (activeAttribute != null && this._uis.shape) {
                this._uis.shape.node.dispatchEvent(new Event('click'));
                this._highlightAttribute(activeAttribute);

                const attrInfo = window.cvat.labelsInfo.attrInfo(activeAttribute);
                if (attrInfo.type === 'text' || attrInfo.type === 'number') {
                    this._uis.attributes[activeAttribute].focus();
                    this._uis.attributes[activeAttribute].select();
                } else {
                    blurAllElements();
                }
            } else {
                this._highlightAttribute(null);
            }
            break;
        case 'color': {
            this._appearance.colors = model.color;
            this._applyColorSettings();
            this._updateColorForDots();
            break;
        }
        case 'z_order': {
            if (this._uis.shape) {
                this._uis.shape.attr('z_order', interpolation.position.z_order);
                ShapeCollectionView.sortByZOrder();
                return;
            }
            break;
        }
        case 'selection': {
            if (model.selected) {
                this._select();
            } else {
                this._deselect();
            }
            break;
        }
        }

        if (model.active || activeAttribute != null) {
            this._select();
            if (activeAttribute === null) {
                this._makeEditable();
            }
        }

        if (model.active || !hiddenText) {
            this._showShapeText();
        }

        function setupHidden(hiddenShape, hiddenText, attributeId, active, interpolation) {
            this._makeNotEditable();
            this._removeShapeUI();
            this._removeShapeText();

            if (!hiddenShape) {
                this._drawShapeUI(interpolation.position);
                this._setupOccludedUI(interpolation.position.occluded);

                if (!hiddenText || active) {
                    this._showShapeText();
                }

                if (active || attributeId != null) {
                    this._select();
                    if (attributeId === null) {
                        this._makeEditable();
                    } else {
                        this._highlightAttribute(attributeId);
                    }
                }
            }
        }
    }

    _applyColorSettings() {
        if (this._uis.shape) {
            if (!this._uis.shape.hasClass('selectedShape')) {
                if (this._appearance.whiteOpacity) {
                    this._uis.shape.attr({
                        'stroke-opacity': this._appearance.fillOpacity,
                        'stroke-width': 1 / window.cvat.player.geometry.scale,
                        'fill-opacity': this._appearance.fillOpacity,
                    });
                } else {
                    this._uis.shape.attr({
                        'stroke-opacity': 1,
                        'stroke-width': STROKE_WIDTH / window.cvat.player.geometry.scale,
                        'fill-opacity': this._appearance.fillOpacity,
                    });
                }
            }

            this._uis.shape.attr({
                stroke: this._appearance.stroke || this._appearance.colors.shape,
                fill: this._appearance.fill || this._appearance.colors.shape,
            });
        }

        if (this._uis.menu) {
            this._uis.menu.css({
                'background-color': this._appearance.fill ? this._appearance.fill : this._appearance.colors.ui,
            });
        }
    }

    updateColorSettings(settings) {
        if ('white-opacity' in settings) {
            this._appearance.whiteOpacity = true;
            this._appearance.fillOpacity = settings['white-opacity'];
            this._appearance.fill = '#ffffff';
            this._appearance.stroke = '#ffffff';
        } else {
            this._appearance.whiteOpacity = false;
            delete this._appearance.stroke;
            delete this._appearance.fill;

            if ('fill-opacity' in settings) {
                this._appearance.fillOpacity = settings['fill-opacity'];
            }

            if (settings['color-by-group']) {
                const color = settings['colors-by-group'](this._controller.model().groupId);
                this._appearance.stroke = color;
                this._appearance.fill = color;
            } else if (settings['color-by-label']) {
                const color = settings['colors-by-label'](window.cvat.labelsInfo.labelColorIdx(this._controller.label));
                this._appearance.stroke = color;
                this._appearance.fill = color;
            }
        }

        if ('selected-fill-opacity' in settings) {
            this._appearance.selectedFillOpacity = settings['selected-fill-opacity'];
        }

        if (settings['black-stroke']) {
            this._appearance.stroke = 'black';
        } else if (!(settings['color-by-group'] || settings['color-by-label'] || settings['white-opacity'])) {
            delete this._appearance.stroke;
        }

        this._applyColorSettings();
        if (this._flags.editable) {
            this._updateColorForDots();
        }
    }

    // Used by shapeCollectionView for select management
    get dragging() {
        return this._flags.dragging;
    }

    // Used by shapeCollectionView for resize management
    get resize() {
        return this._flags.resizing;
    }

    get updateReason() {
        return this._updateReason;
    }

    /**
     * Used in shapeGrouper in order to get model via controller and set group id.
     *
     * @returns {ShapeController}
     */
    controller() {
        return this._controller;
    }
}

ShapeView.shortkeys = function () {
    if (!ShapeView._shortkeys) {
        ShapeView._shortkeys = window.cvat.config.shortkeys;
    }
    return ShapeView._shortkeys;
};

ShapeView.labels = function () {
    if (!ShapeView._labels) {
        ShapeView._labels = window.cvat.labelsInfo.labels();
    }
    return ShapeView._labels;
};

class BoxView extends ShapeView {
    /**
     * @param {BoxModel} boxModel
     * @param {BoxController} boxController
     * @param {SVG.Element} svgScene
     * @param {jQuery} menusScene
     * @param {SVG.Element} textsScene
     */
    constructor(boxModel, boxController, svgScene, menusScene, textsScene) {
        super(boxModel, boxController, svgScene, menusScene, textsScene);

        this._uis.boxSize = null;
    }

    /**
     * See parent implementation comment.
     */
    _makeEditable() {
        if (this._uis.shape && this._uis.shape.node.parentElement && !this._flags.editable) {
            if (!this._controller.lock) {
                this._uis.shape
                    .on('resizestart', (e) => {
                        if (this._uis.boxSize) {
                            this._uis.boxSize.rm();
                            this._uis.boxSize = null;
                        }

                        this._uis.boxSize = drawBoxSize(this._scenes.svg, this._scenes.texts, e.target.getBBox());
                    })
                    .on('resizing', (e) => {
                        this._uis.boxSize = drawBoxSize.call(this._uis.boxSize, this._scenes.svg, this._scenes.texts, e.target.getBBox());
                    })
                    .on('resizedone', () => {
                        this._uis.boxSize.rm();
                    });
            }
            ShapeView.prototype._makeEditable.call(this);
        }
    }

    _makeNotEditable() {
        if (this._uis.boxSize) {
            this._uis.boxSize.rm();
            this._uis.boxSize = null;
        }
        ShapeView.prototype._makeNotEditable.call(this);
    }

    _buildPosition() {
        const shape = this._uis.shape.node;
        return window.cvat.translate.box.canvasToActual({
            xtl: +shape.getAttribute('x'),
            ytl: +shape.getAttribute('y'),
            xbr: +shape.getAttribute('x') + +shape.getAttribute('width'),
            ybr: +shape.getAttribute('y') + +shape.getAttribute('height'),
            occluded: this._uis.shape.hasClass('occludedShape'),
            outside: false, // if drag or resize possible, track is not outside
            z_order: +shape.getAttribute('z_order'),
        });
    }

    /**
     * Draw the box, actually.
     *
     * @param {BoxPosition} position Position of the shape.
     */
    _drawShapeUI(position) {
        position = window.cvat.translate.box.actualToCanvas(position);
        const width = position.xbr - position.xtl;
        const height = position.ybr - position.ytl;

        this._uis.shape = this._scenes.svg
            .rect()
            .size(width, height)
            .attr({
                fill: this._appearance.fill || this._appearance.colors.shape,
                stroke: this._appearance.stroke || this._appearance.colors.shape,
                'stroke-width': STROKE_WIDTH / window.cvat.player.geometry.scale,
                z_order: position.z_order,
                'fill-opacity': this._appearance.fillOpacity,
            })
            .move(position.xtl, position.ytl)
            .addClass('shape');

        // Call parent implementation.
        ShapeView.prototype._drawShapeUI.call(this);
    }

    /**
     * Resize this shape according to a shape that is being resized manually.
     *
     * @param {{x: number, y: number, event: Object}} resizeDetail Detail of the resize operation.
     */
    resizeByMouseEvent(resizeDetail) {

    }
}

class PolyShapeView extends ShapeView {
    /**
     * @param {PolyShapeModel} polyShapeModel
     * @param {PolyShapeController} polyShapeController
     * @param {SVG.Element} svgScene
     * @param {jQuery} menusScene
     * @param {SVG.Element} textsScene
     */
    constructor(polyShapeModel, polyShapeController, svgScene, menusScene, textsScene) {
        super(polyShapeModel, polyShapeController, svgScene, menusScene, textsScene);
    }

    _buildPosition() {
        return {
            points: window.cvat.translate.points.canvasToActual(this._uis.shape.node.getAttribute('points')),
            occluded: this._uis.shape.hasClass('occludedShape'),
            outside: false,
            z_order: +this._uis.shape.node.getAttribute('z_order'),
        };
    }

    /**
     * See parent implementation comment.
     */
    _makeEditable() {
        ShapeView.prototype._makeEditable.call(this);
        if (this._flags.editable) {
            for (let point of $('.svg_select_points')) {
                point = $(point);

                point.on('contextmenu.contextMenu', (e) => {
                    $('.custom-menu').hide(100);
                    this._pointContextMenu.attr('point_idx', point.index());
                    this._pointContextMenu.attr('dom_point_id', point.attr('id'));

                    this._pointContextMenu.finish().show(100);
                    const x = Math.min(e.pageX, this._rightBorderFrame - this._pointContextMenu[0].scrollWidth);
                    const y = Math.min(e.pageY, this._bottomBorderFrame - this._pointContextMenu[0].scrollHeight);
                    this._pointContextMenu.offset({
                        left: x,
                        top: y,
                    });

                    e.preventDefault();
                    e.stopPropagation();
                });

                point.on('dblclick.polyshapeEditor', (e) => {
                    if (this._controller.type === 'interpolation_points') {
                        // Not available for interpolation points
                        return;
                    }

                    if (e.shiftKey) {
                        if (!window.cvat.mode) {
                            // Get index before detach shape from DOM
                            const index = point.index();

                            // Make non active view and detach shape from DOM
                            this._makeNotEditable();
                            this._deselect();
                            if (this._controller.hiddenText) {
                                this._hideShapeText();
                            }
                            this._uis.shape.addClass('hidden');
                            if (this._uis.points) {
                                this._uis.points.addClass('hidden');
                            }

                            // Run edit mode
                            PolyShapeView.editor.edit(this._controller.type.split('_')[1],
                                this._uis.shape.attr('points'), this._color, index,
                                this._uis.shape.attr('points').split(/\s/)[index], e,
                                (points) => {
                                    this._uis.shape.removeClass('hidden');
                                    if (this._uis.points) {
                                        this._uis.points.removeClass('hidden');
                                    }
                                    if (points) {
                                        this._uis.shape.attr('points', points);
                                        this._controller.updatePosition(window.cvat.player.frames.current, this._buildPosition());
                                    }
                                },
                                this._controller.id);
                        }
                    } else {
                        this._controller.model().removePoint(point.index());
                    }
                    e.stopPropagation();
                });
            }
        }
    }

    _makeNotEditable() {
        for (const point of $('.svg_select_points')) {
            $(point).off('contextmenu.contextMenu');
            $(point).off('dblclick.polyshapeEditor');
        }
        ShapeView.prototype._makeNotEditable.call(this);
    }
}

class PolygonView extends PolyShapeView {
    /**
     * @param {PolygonModel} polygonModel
     * @param {PolygonController} polygonController
     * @param {SVG.Element} svgContent
     * @param {jQuery} UIContent
     * @param {SVG.Element} textsScene
     */
    constructor(polygonModel, polygonController, svgContent, UIContent, textsScene) {
        super(polygonModel, polygonController, svgContent, UIContent, textsScene);
    }

    _drawShapeUI(position) {
        const points = window.cvat.translate.points.actualToCanvas(position.points);
        this._uis.shape = this._scenes.svg
            .polygon(points)
            .fill(this._appearance.colors.shape)
            .attr({
                fill: this._appearance.fill || this._appearance.colors.shape,
                stroke: this._appearance.stroke || this._appearance.colors.shape,
                'stroke-width': STROKE_WIDTH / window.cvat.player.geometry.scale,
                z_order: position.z_order,
                'fill-opacity': this._appearance.fillOpacity,
            })
            .addClass('shape');

        ShapeView.prototype._drawShapeUI.call(this);
    }

    /**
     * See parent implementation comment.
     */
    _makeEditable() {
        PolyShapeView.prototype._makeEditable.call(this);
        if (this._flags.editable && !this._controller.draggable) {
            this._uis.shape.draggable(false);
            this._uis.shape.style('cursor', 'default');
        }
    }

    /**
     * Callback to receive update from PolygonModel.
     *
     * @param {PolygonModel} model Polygon model of this PolygonView.
     */
    onShapeUpdate(model) {
        ShapeView.prototype.onShapeUpdate.call(this, model);
        if (model.updateReason === 'draggable' && this._flags.editable) {
            if (model.draggable) {
                this._uis.shape.draggable();
            } else {
                this._uis.shape.draggable(false);
            }
        }
    }

    /**
     * Initialize resize handler.
     * Only used in ShapeCollectionView::startResizeAdjacent().
     *
     * @param {CustomEvent} resizeEvent
     */
    startResizeByAdjacent(resizeEvent) {
        // Get resize handler
        let resizeHandler = this._uis.shape.remember('_resizeHandler');
        if (!resizeHandler || !resizeHandler.options.ignoreEvent) {
            resizeHandler = this._uis.shape
                .selectize({
                    points: [],    // Don't draw points
                    classRect: 'shapeSelect',
                    rotationPoint: false,
                    // pointSize: POINT_RADIUS * 2 / window.cvat.player.geometry.scale,
                    deepSelect: true,
                })
                .resize({
                    snapToGrid: 0.1,
                    ignoreEvent: true,    // TODO: Suppress event without modifying svg.resize.js.
                })
                .remember('_resizeHandler');
        }

        // Initialize resize handler.
        resizeHandler.resize(resizeEvent);
    }

    /**
     * Feed mouse data to resize handler to draw when resizing.
     * Only used in ShapeCollectionView::updateResizeAdjacent().
     *
     * @param {MouseEvent|TouchEvent} mouseEvent Mouse event to feed to resize handler.
     */
    updateResizeByAdjacent(mouseEvent) {
        const resizeHandler = this._uis.shape.remember('_resizeHandler');
        if (resizeHandler) {
            resizeHandler.update(mouseEvent);
        } else {
            console.log(`Premature calls ${this.controller().model().id}`);
        }
    }

    /**
     * Finish resizing: disable selectize & resize and save shape data.
     * Only used in ShapeCollectionView::finishResizeAdjacent().
     *
     * @param {boolean} objWasResized Whether object is actually resized.
     */
    finishResizeByAdjacent(objWasResized) {
        this._uis.shape
            .selectize(false, {
                deepSelect: true,
            })
            .resize('stop');

        if (objWasResized) {
            // Copypasta from resizedone callback in _makeEditable().
            const frame = window.cvat.player.frames.current;
            this.controller().updatePosition(frame, this._buildPosition());
        }
    }
}

class PolylineView extends PolyShapeView {
    /**
     * @param {PolylineModel} polylineModel
     * @param {PolylineController} polylineController
     * @param {SVG.Element} svgScene
     * @param {jQuery} menusScene
     * @param {SVG.Element} textsScene
     */
    constructor(polylineModel, polylineController, svgScene, menusScene, textsScene) {
        super(polylineModel, polylineController, svgScene, menusScene, textsScene);
    }

    _drawShapeUI(position) {
        const points = window.cvat.translate.points.actualToCanvas(position.points);
        this._uis.shape = this._scenes.svg.polyline(points).fill(this._appearance.colors.shape).attr({
            stroke: this._appearance.stroke || this._appearance.colors.shape,
            'stroke-width': STROKE_WIDTH / window.cvat.player.geometry.scale,
            z_order: position.z_order,
        }).addClass('shape polyline');

        ShapeView.prototype._drawShapeUI.call(this);
    }

    _setupMergeView(merge) {
        if (this._uis.shape) {
            if (merge) {
                this._uis.shape.addClass('mergeLine');
            } else {
                this._uis.shape.removeClass('mergeLine');
            }
        }
    }

    _setupGroupView(group) {
        if (this._uis.shape) {
            if (group) {
                this._uis.shape.addClass('groupLine');
            } else {
                this._uis.shape.removeClass('groupLine');
            }
        }
    }

    _deselect() {
        ShapeView.prototype._deselect.call(this);

        if (this._appearance.whiteOpacity) {
            if (this._uis.shape) {
                this._uis.shape.attr({
                    visibility: 'hidden',
                });
            }
        }
    }

    _applyColorSettings() {
        ShapeView.prototype._applyColorSettings.call(this);
        if (this._appearance.whiteOpacity) {
            if (this._uis.shape) {
                this._uis.shape.attr({
                    visibility: 'hidden',
                });
            }
        } else if (this._uis.shape) {
            this._uis.shape.attr({
                visibility: 'visible',
            });
        }
    }
}

class PointsView extends PolyShapeView {
    /**
     * @param {PointsModel} pointsModel
     * @param {PointsController} pointsController
     * @param {SVG.Element} svgScene
     * @param {jQuery} menusScene
     * @param {SVG.Element} textsScene
     */
    constructor(pointsModel, pointsController, svgScene, menusScene, textsScene) {
        super(pointsModel, pointsController, svgScene, menusScene, textsScene);
        this._uis.points = null;
    }

    _setupMergeView(merge) {
        if (this._uis.points) {
            if (merge) {
                this._uis.points.addClass('mergePoints');
            } else {
                this._uis.points.removeClass('mergePoints');
            }
        }
    }

    _setupGroupView(group) {
        if (this._uis.points) {
            if (group) {
                this._uis.points.addClass('groupPoints');
            } else {
                this._uis.points.removeClass('groupPoints');
            }
        }
    }

    _drawPointMarkers(position) {
        if (this._uis.points || position.outside) {
            return;
        }

        this._uis.points = this._scenes.svg
            .group()
            .fill(this._appearance.fill || this._appearance.colors.shape)
            .on('click', () => {
                this._positionateMenus();
                this._controller.click();
            })
            .addClass('pointTempGroup');

        this._uis.points.node.setAttribute('z_order', position.z_order);

        const points = PolyShapeModel.convertStringToNumberArray(position.points);
        for (const point of points) {
            const radius = POINT_RADIUS * 2 / window.cvat.player.geometry.scale;
            const scaledStroke = STROKE_WIDTH / window.cvat.player.geometry.scale;
            this._uis.points
                .circle(radius)
                .move(point.x - radius / 2, point.y - radius / 2)
                .fill('inherit').stroke('black')
                .attr('stroke-width', scaledStroke)
                .addClass('tempMarker');
        }
    }

    _removePointMarkers() {
        if (this._uis.points) {
            this._uis.points.off('click');
            this._uis.points.remove();
            this._uis.points = null;
        }
    }

    /**
     * See parent implementation comment.
     */
    _makeEditable() {
        PolyShapeView.prototype._makeEditable.call(this);
        if (!this._controller.lock) {
            $('.svg_select_points').on('click', () => this._positionateMenus());
            this._removePointMarkers();
        }
    }

    /**
     * See parent implementation comment.
     */
    _makeNotEditable() {
        PolyShapeView.prototype._makeNotEditable.call(this);
        if (!this._controller.hiddenShape) {
            const interpolation = this._controller.interpolate(window.cvat.player.frames.current);
            if (interpolation.position.points) {
                const points = window.cvat.translate.points.actualToCanvas(interpolation.position.points);
                this._drawPointMarkers(Object.assign(interpolation.position, { points }));
            }
        }
    }

    _drawShapeUI(position) {
        const points = window.cvat.translate.points.actualToCanvas(position.points);
        this._uis.shape = this._scenes.svg
            .polyline(points)
            .addClass('shape points')
            .attr({
                z_order: position.z_order,
            });
        this._drawPointMarkers(Object.assign(position, { points }));
        ShapeView.prototype._drawShapeUI.call(this);
    }

    _removeShapeUI() {
        ShapeView.prototype._removeShapeUI.call(this);
        this._removePointMarkers();
    }

    _deselect() {
        ShapeView.prototype._deselect.call(this);

        if (this._appearance.whiteOpacity) {
            if (this._uis.points) {
                this._uis.points.attr({
                    visibility: 'hidden',
                });
            }

            if (this._uis.shape) {
                this._uis.shape.attr({
                    visibility: 'hidden',
                });
            }
        }
    }

    _applyColorSettings() {
        ShapeView.prototype._applyColorSettings.call(this);

        if (this._appearance.whiteOpacity) {
            if (this._uis.points) {
                this._uis.points.attr({
                    visibility: 'hidden',
                });
            }

            if (this._uis.shape) {
                this._uis.shape.attr({
                    visibility: 'hidden',
                });
            }
        } else {
            if (this._uis.points) {
                this._uis.points.attr({
                    visibility: 'visible',
                    fill: this._appearance.fill || this._appearance.colors.shape,
                });
            }

            if (this._uis.shape) {
                this._uis.shape.attr({
                    visibility: 'visible',
                });
            }
        }
    }
}

/**
 * Given 2 points, check if they are adjacent (distance less than 2% of canvas's larger side).
 *
 * @returns {boolean} Whether they are adjacent or not.
 */
function isAdjacent(p1, p2) {
    if (p1.x === p2.x && p1.y === p2.y) {
        return true;
    }
    const { frameWidth, frameHeight } = window.cvat.player.geometry;
    const THRESHOLD = 0.02 * Math.min(frameWidth, frameHeight);
    return Math.abs(p1.x - p2.x) <= THRESHOLD && Math.abs(p1.y - p2.y) <= THRESHOLD;    // Acceptable, faster == better.
}

function buildShapeModel(data, type, clientID, color) {
    // Note switch fall through.
    switch (type) {
    case 'interpolation_box':
    case 'annotation_box':
    case 'interpolation_box_by_4_points':
    case 'annotation_box_by_4_points':
        // convert type into 'box' if 'box_by_4_points'
        type = type.replace('_by_4_points', '');
        return new BoxModel(data, type, clientID, color);
    case 'interpolation_points':
    case 'annotation_points':
        return new PointsModel(data, type, clientID, color);
    case 'interpolation_polyline':
    case 'annotation_polyline':
        return new PolylineModel(data, type, clientID, color);
    case 'interpolation_polygon':
    case 'annotation_polygon':
        return new PolygonModel(data, type, clientID, color);
    case 'interpolation_cuboid':
    case 'annotation_cuboid':
        return new CuboidModel(data, type, clientID, color);
    }
    throw Error('Unreacheable code was reached.');
}

/**
 * @param {ShapeModel} shapeModel
 */
function buildShapeController(shapeModel) {
    switch (shapeModel.type) {
    case 'interpolation_box':
    case 'annotation_box':
        return new BoxController(shapeModel);
    case 'interpolation_points':
    case 'annotation_points':
        return new PointsController(shapeModel);
    case 'interpolation_polyline':
    case 'annotation_polyline':
        return new PolylineController(shapeModel);
    case 'interpolation_polygon':
    case 'annotation_polygon':
        return new PolygonController(shapeModel);
    case 'interpolation_cuboid':
    case 'annotation_cuboid':
        return new CuboidController(shapeModel);
    }
    throw Error('Unreacheable code was reached.');
}

/**
 * @param {ShapeModel} shapeModel
 * @param {ShapeController} shapeController
 * @param {SVG.Element} svgContent
 * @param {jQuery} UIContent
 * @param {SVG.Element} textsContent
 */
function buildShapeView(shapeModel, shapeController, svgContent, UIContent, textsContent) {
    switch (shapeModel.type) {
    case 'interpolation_box':
    case 'annotation_box':
        return new BoxView(shapeModel, shapeController, svgContent, UIContent, textsContent);
    case 'interpolation_points':
    case 'annotation_points':
        return new PointsView(shapeModel, shapeController, svgContent, UIContent, textsContent);
    case 'interpolation_polyline':
    case 'annotation_polyline':
        return new PolylineView(shapeModel, shapeController, svgContent, UIContent, textsContent);
    case 'interpolation_polygon':
    case 'annotation_polygon':
        return new PolygonView(shapeModel, shapeController, svgContent, UIContent, textsContent);
    case 'interpolation_cuboid':
    case 'annotation_cuboid':
        return new CuboidView(shapeModel, shapeController, svgContent, UIContent, textsContent);
    }
    throw Error('Unreacheable code was reached.');
}
