/* eslint-disable no-inner-declarations */
/* eslint-disable no-console */
/* eslint-disable no-multi-spaces */
/* eslint-disable guard-for-in */
/* eslint-disable no-use-before-define */
/* eslint-disable no-alert */
/* eslint-disable eqeqeq */
/* eslint-disable default-case */
/* eslint-disable camelcase */
/* eslint-disable no-underscore-dangle */
/* eslint-disable no-plusplus */
/* eslint-disable max-len */
/*
 * Copyright (C) 2018 Intel Corporation
 *
 * SPDX-License-Identifier: MIT
 */

/* exported ShapeCollectionModel ShapeCollectionController ShapeCollectionView */

/* global
    buildShapeController:false
    buildShapeModel:false
    buildShapeView:false
    copyToClipboard:false
    FilterController:false
    FilterModel:false
    FilterView:false
    Listener:false
    Logger:false
    Mousetrap:false
    POINT_RADIUS:false
    SELECT_POINT_STROKE_WIDTH:false
    ShapeSplitter:false
    STROKE_WIDTH:false
    SVG:false
*/

'use strict';

class ShapeCollectionModel extends Listener {
    constructor() {
        super('onCollectionUpdate', () => this);

        // Dict of frame's shapes, keyed with frame number.
        // It can't be an array, as array has to be continuous.
        /** @type {Object.<number, ShapeModel>} */
        this._annotationShapes = {};

        this._groups = {};
        this._interpolationShapes = [];

        // List of all shapes.
        /** @type {ShapeModel[]} */
        this._shapes = [];

        this._showAllInterpolation = false;

        /** @type {{model: ShapeModel, interpolation: ShapeInFrame}} */
        this._currentShapes = [];

        this._idx = 0;
        this._groupIdx = 0;
        this._frame = null;
        this._activeShape = null;
        this._flush = false;

        /**
         * Last position of the mouse, in canvas coordinate.
         *
         *  @type {SVGPoint}
         */
        this._lastPos = { x: 0, y: 0 };

        this._z_order = { max: 0, min: 0 };

        /** @type {string[]} */
        this._colors = [
            '#0066FF', '#AF593E', '#01A368', '#FF861F', '#ED0A3F', '#FF3F34', '#76D7EA',
            '#8359A3', '#FBE870', '#C5E17A', '#03BB85', '#FFDF00', '#8B8680', '#0A6B0D',
            '#8FD8D8', '#A36F40', '#F653A6', '#CA3435', '#FFCBA4', '#FF99CC', '#FA9D5A',
            '#FFAE42', '#A78B00', '#788193', '#514E49', '#1164B4', '#F4FA9F', '#FED8B1',
            '#C32148', '#01796F', '#E90067', '#FF91A4', '#404E5A', '#6CDAE7', '#FFC1CC',
            '#006A93', '#867200', '#E2B631', '#6EEB6E', '#FFC800', '#CC99BA', '#FF007C',
            '#BC6CAC', '#DCCCD7', '#EBE1C2', '#A6AAAE', '#B99685', '#0086A7', '#5E4330',
            '#C8A2C8', '#708EB3', '#BC8777', '#B2592D', '#497E48', '#6A2963', '#E6335F',
            '#00755E', '#B5A895', '#0048ba', '#EED9C4', '#C88A65', '#FF6E4A', '#87421F',
            '#B2BEB5', '#926F5B', '#00B9FB', '#6456B7', '#DB5079', '#C62D42', '#FA9C44',
            '#DA8A67', '#FD7C6E', '#93CCEA', '#FCF686', '#503E32', '#FF5470', '#9DE093',
            '#FF7A00', '#4F69C6', '#A50B5E', '#F0E68C', '#FDFF00', '#F091A9', '#FFFF66',
            '#6F9940', '#FC74FD', '#652DC1', '#D6AEDD', '#EE34D2', '#BB3385', '#6B3FA0',
            '#33CC99', '#FFDB00', '#87FF2A', '#6EEB6E', '#FFC800', '#CC99BA', '#7A89B8',
            '#006A93', '#867200', '#E2B631', '#D9D6CF',
        ];

        this._colorIdx = 0;
        this._filter = new FilterModel(() => this.update());
        this._splitter = new ShapeSplitter();
    }

    _nextGroupIdx() {
        return ++this._groupIdx;
    }

    /**
     * Randomize color.
     *
     * @param {{shape: string, ui: string}}
     */
    nextColor() {
        // Step used for more color variability
        const idx = ++this._colorIdx % this._colors.length;
        const color = this._colors[idx];

        return {
            shape: color,
            ui: color,
        };
    }

    /**
     * Compute all shapes' position, including interpolated shapes.
     * The returned array is assigned to this._currentShapes.
     *
     * @param {number} frame Frame number.
     * @returns {{model: ShapeModel, interpolation: ShapeInFrame}}
     */
    _computeInterpolation(frame) {
        const interpolated = [];
        for (const shape of (this._annotationShapes[frame] || []).concat(this._interpolationShapes)) {
            if (!shape.removed) {
                const interpolation = shape.interpolate(frame);
                if (!interpolation.position.outside || shape.isKeyFrame(frame)
                    || (shape.type.split('_')[0] === 'interpolation' && this._showAllInterpolation)) {
                    interpolated.push({
                        model: shape,
                        interpolation: shape.interpolate(frame),
                    });
                }
            }
        }

        return interpolated;
    }

    _clear() {
        this._z_order.max = 0;
        this._z_order.min = 0;

        if (this._activeShape) {
            if (this._activeShape.activeAttribute != null) {
                this._activeShape.activeAttribute = null;
            }
            this.resetActive();
        }

        this._currentShapes = [];
    }

    _interpolate() {
        this._clear();
        this._currentShapes = this._computeInterpolation(this._frame);
        for (const shape of this._currentShapes) {
            const { z_order } = shape.interpolation.position;
            if (z_order > this._z_order.max) {
                this._z_order.max = z_order;
            }
            if (z_order < this._z_order.min) {
                this._z_order.min = z_order;
            }
        }

        this._currentShapes = this._filter.filter(this._currentShapes);
        this.notify();
    }

    _removeFromGroup(elem) {
        const { groupId } = elem;

        // Check if elem in group
        if (groupId) {
            if (groupId in this._groups) {
                // Remove from group
                const idx = this._groups[groupId].indexOf(elem);
                if (idx != -1) {
                    this._groups[groupId].splice(idx, 1);
                }

                // Now remove group if it empty
                if (!this._groups[groupId].length) {
                    delete this._groups[groupId];
                }
            }
            elem.groupId = 0;
        }
    }

    // Common code for switchActiveOccluded(), switchActiveKeyframe(), switchActiveLock() and switchActiveOutside()
    _selectActive() {
        let shape = null;
        if (this._activeAAMShape) {
            shape = this._activeAAMShape;
        } else {
            this.selectShape(this._lastPos, false);
            if (this._activeShape) {
                shape = this._activeShape;
            }
        }

        return shape;
    }

    cleanupClientObjects() {
        for (const shape of this._shapes) {
            if (typeof (shape.serverID) === 'undefined') {
                shape.removed = true;
            }
        }

        this.notify();
    }

    colorsByGroup(groupId) {
        // If group id of shape is 0 (default value), then shape not contained in a group
        if (!groupId) {
            return '#ffffff';
        }

        return this._colors[groupId % this._colors.length];
    }

    joinToGroup(elements) {
        const groupIdx = this._nextGroupIdx();
        this._groups[groupIdx] = [];

        for (const elem of elements) {
            // Clear old group
            this._removeFromGroup(elem);
            this._groups[groupIdx].push(elem);
            elem.groupId = groupIdx;
        }
    }

    resetGroupFor(elements) {
        for (const elem of elements) {
            this._removeFromGroup(elem);
        }
    }

    updateGroupIdx(groupId) {
        if (groupId in this._groups) {
            const newGroupId = this._nextGroupIdx();
            this._groups[newGroupId] = this._groups[groupId];
            delete this._groups[groupId];
            for (const elem of this._groups[newGroupId]) {
                elem.groupId = newGroupId;
            }
        }
    }

    /**
     * Import data to ShapeCollectionModel to render.
     * In buildAnnotationUI(), there is an instance of this function
     * followed by ShapeCollectionModel::update(). Is it mandatory?
     *
     * @param {Object} data Server data of all shapes in this job.
     * @returns {ShapeCollectionModel} This object.
     */
    import(data) {
        /**
         * Convert from server shape object to client shape object in place.
         */
        function _convertShape(shape) {
            if (shape.type === 'rectangle') {
                Object.assign(shape, window.cvat.translate.box.serverToClient(shape));
                delete shape.points;
                shape.type = 'box';
            } else {
                Object.assign(shape, window.cvat.translate.points.serverToClient(shape));
            }

            for (const attr of shape.attributes) {
                attr.id = attr.spec_id;
                delete attr.spec_id;
            }
        }

        // Make copy of data in order to don't affect original data
        data = JSON.parse(JSON.stringify(data));

        for (const imported of data.shapes.concat(data.tracks)) {
            // Conversion from client object format to server object format
            if (imported.shapes) {
                for (const attr of imported.attributes) {
                    attr.id = attr.spec_id;
                    delete attr.spec_id;
                }

                for (const shape of imported.shapes) {
                    _convertShape(shape);
                }
                this.add(imported, `interpolation_${imported.shapes[0].type}`);
            } else {
                _convertShape(imported);
                this.add(imported, `annotation_${imported.type}`);
            }
        }

        this.notify();
        return this;
    }

    /**
     * Export data from ShapeCollectionModel to server format.
     * Mostly it's the reverse of import().
     *
     * @returns {Object[]} Array of 2 objects:
     *                       - 1st object: raw shape data, similar to import()'s input argument.
     *                       - 2nd object: array of [Object, ShapeModel] pair, the Object
     *                         is a raw shape data object included in the 1st object.
     */
    export() {
        function _convertShape(shape) {
            if (shape.type === 'box') {
                Object.assign(shape, window.cvat.translate.box.clientToServer(shape));
                shape.type = 'rectangle';
                delete shape.xtl;
                delete shape.ytl;
                delete shape.xbr;
                delete shape.ybr;
            } else {
                Object.assign(shape, window.cvat.translate.points.clientToServer(shape));
            }

            for (const attr of shape.attributes) {
                attr.spec_id = attr.id;
                delete attr.id;
            }
        }

        const data = {
            shapes: [],    // Array of raw shape data created in annotation mode.
            tracks: [],    // Array of raw shape data created in tracking mode.
        };

        const mapping = [];

        for (const shape of this._shapes) {
            if (!shape.removed) {
                const exported = shape.export();
                // Conversion from client object format to server object format
                if (exported.shapes) {
                    for (const attr of exported.attributes) {
                        attr.spec_id = attr.id;
                        delete attr.id;
                    }

                    for (const shape of exported.shapes) {
                        _convertShape(shape);
                    }
                } else {
                    _convertShape(exported);
                }

                if (shape.type.split('_')[0] === 'annotation') {
                    data.shapes.push(exported);
                } else {
                    data.tracks.push(exported);
                }

                mapping.push([exported, shape]);
            }
        }

        return [data, mapping];
    }

    find(direction) {
        if (Math.sign(direction) > 0) {
            let frame = this._frame + 1;
            while (frame <= window.cvat.player.frames.stop) {
                let shapes = this._computeInterpolation(frame);
                shapes = this._filter.filter(shapes);
                if (shapes.length) {
                    return frame;
                }
                frame++;
            }
        } else {
            let frame = this._frame - 1;
            while (frame >= window.cvat.player.frames.start) {
                let shapes = this._computeInterpolation(frame);
                shapes = this._filter.filter(shapes);
                if (shapes.length) {
                    return frame;
                }
                frame--;
            }
        }
        return null;
    }

    zOrder(frame) {
        if (frame === this._frame) {
            this._z_order.max++;
            this._z_order.min--;
            return {
                max: this._z_order.max,
                min: this._z_order.min,
            };
        }

        const interpolation = this._computeInterpolation(frame);
        let max = 0;
        let min = 0;
        for (const shape of interpolation) {
            const { z_order } = shape.interpolation.position;
            if (z_order > max) {
                max = z_order;
            }
            if (z_order < min) {
                min = z_order;
            }
        }
        return {
            max: max + 1,
            min: min - 1,
        };
    }

    empty() {
        this._flush = true;
        this._annotationShapes = {};
        this._interpolationShapes = [];
        this._shapes = [];
        this._idx = 0;
        this._colorIdx = 0;
        this._interpolate();
    }

    /**
     * Adding a shape (pressing N in CVAT).
     *
     * @param {Object} data  Shape data, including coordinates.
     * @param {string} type  Shape type string, of the following format:
     *                         {annotation_mode}_{shape_type}
     *                       add_mode could be interpolation or annotation
     *                       shape_type could be box, polygon,...
     * @returns {ShapeModel} The added shape model.
     */
    add(data, type) {
        this._idx += 1;
        const id = this._idx;
        const model = buildShapeModel(data, type, id, this.nextColor());

        if (type.startsWith('interpolation')) {
            this._interpolationShapes.push(model);
        } else {
            this._annotationShapes[model.frame] = this._annotationShapes[model.frame] || [];
            this._annotationShapes[model.frame].push(model);    // Add shape to list of shapes in the frame.
        }
        this._shapes.push(model);    // Add shape to list of all shapes.
        model.subscribe(this);

        // Update collection groups & group index
        const groupIdx = model.groupId;
        this._groupIdx = Math.max(this._groupIdx, groupIdx);
        if (groupIdx) {
            this._groups[groupIdx] = this._groups[groupIdx] || [];
            this._groups[groupIdx].push(model);
        }
        return model;
    }

    /**
     * Given a position in the canvas, select a shape containing that position (if there is one).
     * Open shapes (polyline, points) is preferred over closed shapes (the rest).
     * This function is called whenever the mouse moves in the player frame.
     * A shape is selected but not activated by hovering the mouse over it, hence
     * the noActivation option. The shape is activated only if it is clicked.
     * If noActivation is true, the selected shape's model is returned. Otherwise,
     * this._activeShape is updated with the shape, and nothing is returned.
     *
     * @param {SVGPoint} pos Position (of the mouse) in canvas coordinate.
     * @param {boolean} noActivation Do not activate the shape.
     * @returns {ShapeModel} A model of the selected shape. Only returns if noActivation is true.
     */
    selectShape(pos, noActivation) {
        const closedShape = {
            minDistance: Number.MAX_SAFE_INTEGER,
            shape: null,
        };

        const openShape = {
            minDistance: 5 / window.cvat.player.geometry.scale,
            shape: null,
        };

        for (const shape of this._currentShapes) {
            if (shape.model.hiddenShape) continue;
            if (shape.model.removed) continue;

            switch (shape.model.type.split('_')[1]) {
            case 'box':
            case 'polygon':
            case 'cuboid':
                if (shape.model.contain(pos, this._frame)) {
                    const distance = shape.model.distance(pos, this._frame);
                    if (distance < closedShape.minDistance) {
                        closedShape.minDistance = distance;
                        closedShape.shape = shape.model;
                    }
                }
                break;
            case 'polyline':
            case 'points': {
                const distance = shape.model.distance(pos, this._frame);
                if (distance < openShape.minDistance) {
                    openShape.minDistance = distance;
                    openShape.shape = shape.model;
                }
                break;
            }
            }
        }

        let active = closedShape.shape;
        if (openShape.shape) {
            active = openShape.shape;
        }

        if (noActivation) {
            return active;
        }

        if (active && active != this._activeShape) {
            if (this._activeShape) {
                this._activeShape.active = false;
                this._activeShape = null;
            }
            this._activeShape = active;
            this._activeShape.active = true;
        }
    }

    update() {
        this._interpolate();
    }

    /**
     * Deselect active shape.
     */
    resetActive() {
        if (this._activeShape) {
            this._activeShape.active = false;
            this._activeShape = null;
        }
    }

    onPlayerUpdate(player) {
        if (player.ready()) {
            const frame = player.frames.current;

            // If frame was not changed and collection already interpolated (for example after pause() call)
            if (frame === this._frame && this._currentShapes.length) return;

            if (this._activeShape) {
                if (this._activeShape.activeAttribute != null) {
                    this._activeShape.activeAttribute = null;
                }
                this.resetActive();
            }

            this._frame = frame;
            this._interpolate();
            if (!window.cvat.mode) {
                this.selectShape(this._lastPos, false);
            }
        } else {
            this._clear();
            this.notify();
        }
    }

    /**
     * Callback used to receive update from ShapeModel.
     *
     * @param {ShapeModel} model A shape model.
     */
    onShapeUpdate(model) {
        switch (model.updateReason) {
        case 'activeAttribute':
            if (model.activeAttribute != null) {
                if (this._activeShape && this._activeShape != model) {
                    this.resetActive();
                }
                this._activeShape = model;
            } else if (this._activeShape) {
                this.resetActive();
            }
            break;
        case 'activation': {
            const { active } = model;
            if (active) {
                if (this._activeShape != model) {
                    if (this._activeShape) {
                        this._activeShape.active = false;
                        // Now loop occure -> active(false) -> notify -> onShapeUpdate
                        // But it will go on 'else' branch and this._activeShape will set to null
                    }
                    this._activeShape = model;
                }
            } else if (this._activeShape === model) {
                this._activeShape = null;
            }
            break;
        }
        case 'remove':
            if (model.removed) {
                if (this._activeShape === model) {
                    this._activeShape = null;
                }
                break;
            }
            this.update();
            break;
        case 'keyframe':
        case 'outside':
            this.update();
            break;
        }
    }

    onShapeCreatorUpdate(shapeCreator) {
        if (shapeCreator.createMode) {
            this.resetActive();
        }
    }

    collectStatistic() {
        const statistic = {};
        const labels = window.cvat.labelsInfo.labels();
        for (const labelId in labels) {
            statistic[labelId] = {
                boxes: {
                    annotation: 0,
                    interpolation: 0,
                },
                polygons: {
                    annotation: 0,
                    interpolation: 0,
                },
                polylines: {
                    annotation: 0,
                    interpolation: 0,
                },
                points: {
                    annotation: 0,
                    interpolation: 0,
                },
                cuboids: {
                    annotation: 0,
                    interpolation: 0,
                },
                manually: 0,
                interpolated: 0,
                total: 0,
            };
        }

        const totalForLabels = {
            boxes: {
                annotation: 0,
                interpolation: 0,
            },
            polygons: {
                annotation: 0,
                interpolation: 0,
            },
            polylines: {
                annotation: 0,
                interpolation: 0,
            },
            points: {
                annotation: 0,
                interpolation: 0,
            },
            cuboids: {
                annotation: 0,
                interpolation: 0,
            },
            manually: 0,
            interpolated: 0,
            total: 0,
        };

        for (const shape of this._shapes) {
            if (shape.removed) continue;
            const statShape = shape.collectStatistic();
            statistic[statShape.labelId].manually += statShape.manually;
            statistic[statShape.labelId].interpolated += statShape.interpolated;
            statistic[statShape.labelId].total += statShape.total;
            switch (statShape.type) {
            case 'box':
                statistic[statShape.labelId].boxes[statShape.mode]++;
                break;
            case 'polygon':
                statistic[statShape.labelId].polygons[statShape.mode]++;
                break;
            case 'polyline':
                statistic[statShape.labelId].polylines[statShape.mode]++;
                break;
            case 'points':
                statistic[statShape.labelId].points[statShape.mode]++;
                break;
            case 'cuboid':
                statistic[statShape.labelId].cuboids[statShape.mode]++;
                break;
            default:
                throw Error(`Unknown shape type found: ${statShape.type}`);
            }
        }

        for (const labelId in labels) {
            totalForLabels.boxes.annotation += statistic[labelId].boxes.annotation;
            totalForLabels.boxes.interpolation += statistic[labelId].boxes.interpolation;
            totalForLabels.polygons.annotation += statistic[labelId].polygons.annotation;
            totalForLabels.polygons.interpolation += statistic[labelId].polygons.interpolation;
            totalForLabels.polylines.annotation += statistic[labelId].polylines.annotation;
            totalForLabels.polylines.interpolation += statistic[labelId].polylines.interpolation;
            totalForLabels.points.annotation += statistic[labelId].points.annotation;
            totalForLabels.points.interpolation += statistic[labelId].points.interpolation;
            totalForLabels.cuboids.annotation += statistic[labelId].cuboids.annotation;
            totalForLabels.cuboids.interpolation += statistic[labelId].cuboids.interpolation;
            totalForLabels.cuboids.interpolation += statistic[labelId].cuboids.interpolation;
            totalForLabels.manually += statistic[labelId].manually;
            totalForLabels.interpolated += statistic[labelId].interpolated;
            totalForLabels.total += statistic[labelId].total;
        }

        return [statistic, totalForLabels];
    }

    switchActiveLock() {
        const shape = this._selectActive();

        if (shape) {
            shape.switchLock();
            Logger.addEvent(Logger.EventType.lockObject, {
                count: 1,
                value: !shape.lock,
            });
        }
    }

    switchObjectsLock(labelId) {
        this.resetActive();
        let value = true;

        const shapes = Number.isInteger(labelId) ? this._currentShapes.filter((el) => el.model.label === labelId) : this._currentShapes;
        for (const shape of shapes) {
            if (shape.model.removed) continue;
            value = value && shape.model.lock;
            if (!value) break;
        }

        Logger.addEvent(Logger.EventType.lockObject, {
            count: this._currentShapes.length,
            value: !value,
        });

        for (const shape of shapes) {
            if (shape.model.removed) continue;
            if (shape.model.lock === value) {
                shape.model.switchLock();
            }
        }
    }

    switchActiveOccluded() {
        const shape = this._selectActive();
        if (shape && !shape.lock) {
            shape.switchOccluded(window.cvat.player.frames.current);
        }
    }

    switchActiveKeyframe() {
        const shape = this._selectActive();
        if (shape && shape.type === 'interpolation_box' && !shape.lock) {
            shape.switchKeyFrame(window.cvat.player.frames.current);
        }
    }

    switchActiveOutside() {
        const shape = this._selectActive();
        if (shape && shape.type === 'interpolation_box' && !shape.lock) {
            shape.switchOutside(window.cvat.player.frames.current);
        }
    }

    switchActiveHide() {
        const shape = this._selectActive();
        if (shape) {
            shape.switchHide();
        }
    }

    switchObjectsHide(labelId) {
        this.resetActive();
        let hiddenShape = true;
        let hiddenText = true;

        const shapes = Number.isInteger(labelId) ? this._shapes.filter((el) => el.label === labelId) : this._shapes;
        for (const shape of shapes) {
            if (shape.removed) continue;
            hiddenShape = hiddenShape && shape.hiddenShape;

            if (!hiddenShape) {
                break;
            }
        }

        if (!hiddenShape) {
            // any shape visible
            for (const shape of shapes) {
                if (shape.removed) continue;
                hiddenText = hiddenText && shape.hiddenText;

                if (!hiddenText) {
                    break;
                }
            }

            if (!hiddenText) {
                // any shape text visible
                for (const shape of shapes) {
                    if (shape.removed) continue;
                    while (shape.hiddenShape || !shape.hiddenText) {
                        shape.switchHide();
                    }
                }
            } else {
                // all shape text invisible
                for (const shape of shapes) {
                    if (shape.removed) continue;
                    while (!shape.hiddenShape) {
                        shape.switchHide();
                    }
                }
            }
        } else {
            // all shapes invisible
            for (const shape of shapes) {
                if (shape.removed) continue;
                while (shape.hiddenShape || shape.hiddenText) {
                    shape.switchHide();
                }
            }
        }
    }

    removePointFromActiveShape(idx) {
        if (this._activeShape && !this._activeShape.lock) {
            this._activeShape.removePoint(idx);
        }
    }

    split() {
        if (this._activeShape) {
            if (!this._activeShape.lock && this._activeShape.type.split('_')[0] === 'interpolation') {
                const list = this._splitter.split(this._activeShape, this._frame);
                const { type } = this._activeShape;
                for (const item of list) {
                    this.add(item, type);
                }

                // Undo/redo code
                const newShapes = this._shapes.slice(-list.length);
                const originalShape = this._activeShape;
                window.cvat.addAction('Split Object', () => {
                    for (const shape of newShapes) {
                        shape.removed = true;
                        shape.unsubscribe(this);
                    }
                    originalShape.removed = false;
                }, () => {
                    for (const shape of newShapes) {
                        shape.removed = false;
                        shape.subscribe(this);
                    }
                    originalShape.removed = true;
                    this.update();
                }, this._frame);
                // End of undo/redo code

                this._activeShape.removed = true;
                this.update();
            }
        }
    }

    selectAllWithLabel(labelId) {
        for (const shape of this.currentShapes) {
            if (shape.model.label === labelId) {
                shape.model.select();
            }
        }
    }

    deselectAll() {
        for (const shape of this.currentShapes) {
            shape.model.deselect();
        }
    }

    get flush() {
        return this._flush;
    }

    set flush(value) {
        this._flush = value;
    }

    get activeShape() {
        return this._activeShape;
    }

    get currentShapes() {
        return this._currentShapes;
    }

    get lastPosition() {
        return this._lastPos;
    }

    set lastPosition(pos) {
        this._lastPos = pos;
    }

    set showAllInterpolation(value) {
        this._showAllInterpolation = value;
        this.update();
    }

    get filter() {
        return this._filter;
    }

    get shapes() {
        return this._shapes;
    }

    get maxId() {
        return Math.max(-1, ...this._shapes.map(shape => shape.id));
    }
}

class ShapeCollectionController {
    constructor(collectionModel) {
        this._model = collectionModel;
        this._filterController = new FilterController(collectionModel.filter);
        setupCollectionShortcuts.call(this);

        function setupCollectionShortcuts() {
            const switchLockHandler = Logger.shortkeyLogDecorator(() => {
                this.switchActiveLock();
            });

            const switchAllLockHandler = Logger.shortkeyLogDecorator(() => {
                this.switchAllLock();
            });

            const switchOccludedHandler = Logger.shortkeyLogDecorator(() => {
                this.switchActiveOccluded();
            });

            const switchActiveKeyframeHandler = Logger.shortkeyLogDecorator(() => {
                this.switchActiveKeyframe();
            });

            const switchActiveOutsideHandler = Logger.shortkeyLogDecorator(() => {
                this.switchActiveOutside();
            });

            const switchHideHandler = Logger.shortkeyLogDecorator(() => {
                this.switchActiveHide();
            });

            const switchAllHideHandler = Logger.shortkeyLogDecorator(() => {
                this.switchAllHide();
            });

            const removeActiveHandler = Logger.shortkeyLogDecorator((e) => {
                this.removeActiveShape(e);
            });

            const switchLabelHandler = Logger.shortkeyLogDecorator((e) => {
                const { activeShape } = this._model;
                if (activeShape) {
                    const labels = Object.keys(window.cvat.labelsInfo.labels());
                    const key = e.keyCode - '1'.charCodeAt(0);
                    if (key in labels) {
                        const labelId = +labels[key];
                        activeShape.changeLabel(labelId);
                    }
                }
                e.preventDefault();
            });

            const switchDefaultLabelHandler = Logger.shortkeyLogDecorator((e) => {
                $('#shapeLabelSelector option').eq(e.keyCode - '1'.charCodeAt(0)).prop('selected', true);
                $('#shapeLabelSelector').trigger('change');
            });

            const changeShapeColorHandler = Logger.shortkeyLogDecorator(() => {
                this.switchActiveColor();
            });

            const incZHandler = Logger.shortkeyLogDecorator(() => {
                if (window.cvat.mode === null) {
                    const { activeShape } = this._model;
                    if (activeShape) {
                        activeShape.z_order = this._model.zOrder(window.cvat.player.frames.current).max;
                    }
                }
            });

            const decZHandler = Logger.shortkeyLogDecorator(() => {
                if (window.cvat.mode === null) {
                    const { activeShape } = this._model;
                    if (activeShape) {
                        activeShape.z_order = this._model.zOrder(window.cvat.player.frames.current).min;
                    }
                }
            });

            const nextShapeType = Logger.shortkeyLogDecorator((e) => {
                if (window.cvat.mode === null) {
                    let next = $('#shapeTypeSelector option').filter(':selected').next();
                    if (!next.length) {
                        next = $('#shapeTypeSelector option').first();
                    }

                    next.prop('selected', true);
                    next.trigger('change');
                }
            });

            const prevShapeType = Logger.shortkeyLogDecorator((e) => {
                if (window.cvat.mode === null) {
                    let prev = $('#shapeTypeSelector option').filter(':selected').prev();
                    if (!prev.length) {
                        prev = $('#shapeTypeSelector option').last();
                    }

                    prev.prop('selected', true);
                    prev.trigger('change');
                }
            });

            const { shortkeys } = window.cvat.config;
            Mousetrap.bind(shortkeys.switch_lock_property.value, switchLockHandler.bind(this), 'keydown');
            Mousetrap.bind(shortkeys.switch_all_lock_property.value, switchAllLockHandler.bind(this), 'keydown');
            Mousetrap.bind(shortkeys.switch_occluded_property.value, switchOccludedHandler.bind(this), 'keydown');
            Mousetrap.bind(shortkeys.switch_active_keyframe.value, switchActiveKeyframeHandler.bind(this), 'keydown');
            Mousetrap.bind(shortkeys.switch_active_outside.value, switchActiveOutsideHandler.bind(this), 'keydown');
            Mousetrap.bind(shortkeys.switch_hide_mode.value, switchHideHandler.bind(this), 'keydown');
            Mousetrap.bind(shortkeys.switch_all_hide_mode.value, switchAllHideHandler.bind(this), 'keydown');
            Mousetrap.bind(shortkeys.change_default_label.value, switchDefaultLabelHandler.bind(this), 'keydown');
            Mousetrap.bind(shortkeys.change_shape_label.value, switchLabelHandler.bind(this), 'keydown');
            Mousetrap.bind(shortkeys.delete_shape.value, removeActiveHandler.bind(this), 'keydown');
            Mousetrap.bind(shortkeys.change_shape_color.value, changeShapeColorHandler.bind(this), 'keydown');
            Mousetrap.bind(shortkeys.next_shape_type.value, nextShapeType.bind(this), 'keydown');
            Mousetrap.bind(shortkeys.prev_shape_type.value, prevShapeType.bind(this), 'keydown');

            if (window.cvat.job.z_order) {
                Mousetrap.bind(shortkeys.inc_z.value, incZHandler.bind(this), 'keydown');
                Mousetrap.bind(shortkeys.dec_z.value, decZHandler.bind(this), 'keydown');
            }
        }
    }

    switchActiveOccluded() {
        if (!window.cvat.mode || window.cvat.mode === 'aam') {
            this._model.switchActiveOccluded();
        }
    }

    switchActiveKeyframe() {
        if (!window.cvat.mode) {
            this._model.switchActiveKeyframe();
        }
    }

    switchActiveOutside() {
        if (!window.cvat.mode) {
            this._model.switchActiveOutside();
        }
    }

    switchAllLock() {
        if (!window.cvat.mode || window.cvat.mode === 'aam') {
            this._model.switchObjectsLock();
        }
    }

    switchLabelLock(labelId) {
        if (!window.cvat.mode || window.cvat.mode === 'aam') {
            this._model.switchObjectsLock(labelId);
        }
    }

    switchActiveLock() {
        if (!window.cvat.mode || window.cvat.mode === 'aam') {
            this._model.switchActiveLock();
        }
    }

    switchAllHide() {
        if (!window.cvat.mode || window.cvat.mode === 'aam') {
            this._model.switchObjectsHide();
        }
    }

    switchLabelHide(lableId) {
        if (!window.cvat.mode || window.cvat.mode === 'aam') {
            this._model.switchObjectsHide(lableId);
        }
    }

    switchActiveHide() {
        if (!window.cvat.mode || window.cvat.mode === 'aam') {
            this._model.switchActiveHide();
        }
    }

    switchActiveColor() {
        if (!window.cvat.mode || window.cvat.mode === 'aam') {
            const colorByInstanceInput = $('#colorByInstanceRadio');
            const colorByGroupInput = $('#colorByGroupRadio');
            const colorByLabelInput = $('#colorByLabelRadio');

            const { activeShape } = this._model;
            if (activeShape) {
                if (colorByInstanceInput.prop('checked')) {
                    activeShape.changeColor(this._model.nextColor());
                } else if (colorByGroupInput.prop('checked')) {
                    if (activeShape.groupId) {
                        this._model.updateGroupIdx(activeShape.groupId);
                        colorByGroupInput.trigger('change');
                    }
                } else {
                    const labelId = +activeShape.label;
                    window.cvat.labelsInfo.updateLabelColorIdx(labelId);
                    $(`.labelContentElement[label_id="${labelId}"`).css('background-color',
                        this._model.colorsByGroup(window.cvat.labelsInfo.labelColorIdx(labelId)));
                    colorByLabelInput.trigger('change');
                }
            }
        }
    }

    switchDraggableForActive() {
        const { activeShape } = this._model;
        if (activeShape && typeof (activeShape.draggable) !== 'undefined') {
            activeShape.draggable = !activeShape.draggable;
        }
    }

    /**
     * Given the number of row and column, split the active rectangle.
     * This function first removes the rectangle, then adds child ones.
     * The undo/redo is handled here.
     *
     * @param {number} row Number of row. 1 if don't split row.
     * @param {number} col Number of column. 1 if don't split column.
     */
    splitActiveBox(row, col) {
        if (row === 1 && col === 1) {
            return;
        }

        // Margin between child boxes.
        const SPACING = 10;

        // TODO: check window.cvat.mode.
        this._model.selectShape(this._model.lastPosition, false);
        const { activeShape } = this._model;

        let getChildPosition;
        let typeOfShape;

        // TODO: Move this whole if-else block to individual ShapeModel.
        if (activeShape instanceof BoxModel) {
            const {
                xtl, ytl, xbr, ybr,
            } = activeShape._positions[0];

            const width = xbr - xtl;
            const childBoxWidth = (width - SPACING * (col - 1)) / col;
            const height = ybr - ytl;
            const childBoxHeight = (height - SPACING * (row - 1)) / row;

            // Check if the split is feasible
            if (childBoxWidth * childBoxHeight < AREA_TRESHOLD) {
                showMessage('The area of the child boxes are too small.');
                return;
            }

            /**
             * Given the child row and column position in the grid, return its coordinate/positions.
             *
             * @param {number} i Row number of the child.
             * @param {number} j Column number of the child.
             * @returns {Object} Coordinates of the child (i.e. positions).
             */
            getChildPosition = (i, j) => {
                const c_xtl = xtl + j * (childBoxWidth + SPACING);
                const c_xbr = c_xtl + childBoxWidth;
                const c_ytl = ytl + i * (childBoxHeight + SPACING);
                const c_ybr = c_ytl + childBoxHeight;

                return {
                    xtl: c_xtl,
                    ytl: c_ytl,
                    xbr: c_xbr,
                    ybr: c_ybr,
                };
            };
            typeOfShape = 'box';
        } else if (activeShape instanceof PolygonModel) {
            // points are serialized in the following format:
            //   x0,y0 x1,y1...
            const corners = activeShape._positions[0].points
                .split(' ')
                .map(pair => {
                    pair = pair.split(',');
                    return {
                        x: +pair[0],
                        y: +pair[1],
                    };
                });

            // Check if the split is feasible
            if (corners.length !== 4) {
                showMessage('Only quadrilateral can be splitted.');
                return;
            }

            // corners is a (row + 1) x (col + 1) matrix containing all points in the grid
            const points = [...Array(row + 1)].map(() => Array(col + 1));

            const lastRow = row;
            const lastCol = col;

            // First populate the 4 corners
            [
                points[0][0],                // top left
                points[0][lastCol],          // top right
                points[lastRow][lastCol],    // bottom right
                points[lastRow][0],          // bottom left
            ] = sortCorners(corners);

            // Then populate the 2 side edges
            // Yes edge points are reassigned along the way, for better code visibility.
            const rightEdge = linearInterpolatePoints(points[0][lastCol], points[lastRow][lastCol], row - 1);
            for (let i = 0; i < rightEdge.length; i++) points[i][lastCol] = rightEdge[i];
            const leftEdge = linearInterpolatePoints(points[0][0], points[lastRow][0], row - 1);
            for (let i = 0; i < leftEdge.length; i++) points[i][0] = leftEdge[i];

            // Then fill the inside
            for (let i = 0; i <= lastRow; i++) {
                const line = linearInterpolatePoints(points[i][0], points[i][lastCol], col - 1);
                for (let j = 0; j <= lastCol; j++) {
                    points[i][j] = line[j];
                }
            }

            /**
             * The same as the other one.
             */
            getChildPosition = (i, j) => {
                const childPoints = [points[i][j], points[i][j + 1], points[i + 1][j + 1], points[i + 1][j]]
                    .map(point => `${point.x},${point.y}`)
                    .join(' ');

                return {
                    points: childPoints,
                };
            };
            typeOfShape = 'polygon';
        } else {
            showMessage('This type of object does not support splitting.');
            return;
        }

        // Delete the box
        const parent = this.removeActiveShape(
            { shiftKey: true },    // TODO: Check Shift and lock.
            true,                  // No undo/redo, it will be handled here.
        );

        // Add child boxes.
        const children = [];
        const basePosition = {
            attributes: [],
            frame: parent.frame,
            group: parent.groupId,
            label_id: parent.label,
            occluded: parent._positions[0].occluded,
            z_order: parent._positions[0].z_order,
        };

        for (let i = 0; i < row; ++i) {
            for (let j = 0; j < col; ++j) {
                const child = this._model.add(
                    Object.assign({}, basePosition, getChildPosition(i, j)),
                    `annotation_${typeOfShape}`,
                );
                children.push(child);
            }
        }

        // Undo/redo
        // Undo/redo add: ShapeCreatorModel::finish().
        // Undo/redo remove: ShapeModel::remove().
        window.cvat.addAction(
            `Split ${typeOfShape}`,
            () => {
                // Undo create
                for (const child of children) {
                    child.removed = true;
                    child.unsubscribe(this._model);
                }

                // Undo remove
                parent.removed = false;

                // TODO: check if update() is needed in undo/redo.
                // this._model.update();
            },
            () => {
                for (const child of children) {
                    child.removed = false;
                    child.subscribe(this._model);
                }
                parent.removed = true;

                this._model.update();
            },
            window.cvat.player.frames.current,
        );

        // Update model, which triggers rendering.
        this._model.update();

        /**
         * Sort 4 corners of a convex quadrilateral clockwise.
         * The first corner is the top left.
         *
         * @param {Array.<{x: number, y: number}>} corners Corners to be sorted.
         * @returns {Array.<{x: number, y: number}>} Sorted corners.
         */
        function sortCorners(corners) {
            const centroid = {
                x: corners.reduce((acc, corner) => acc + corner.x, 0) / 4,
                y: corners.reduce((acc, corner) => acc + corner.y, 0) / 4,
            };

            return [
                corners.find(corner => corner.x < centroid.x && corner.y < centroid.y),
                corners.find(corner => corner.x > centroid.x && corner.y < centroid.y),
                corners.find(corner => corner.x > centroid.x && corner.y > centroid.y),
                corners.find(corner => corner.x < centroid.x && corner.y > centroid.y),
            ];
        }

        /**
         * Generate in-between points from p1 to p2.
         *
         * @param {{x: number, y: number}} p1 Starting points.
         * @param {{x: number, y: number}} p2 Ending points.
         * @param {number} numOfPoints Number of point to interpolate, excluding p1 and p2.
         * @returns {Array.<{x: number, y: number}>} Generated points, including p1 and p2,
         *                                           so that its length is numOfPoints + 2.
         */
        function linearInterpolatePoints(p1, p2, numOfPoints) {
            const x_step = (p2.x - p1.x - numOfPoints * SPACING) / (numOfPoints + 1);
            const y_step = (p2.y - p1.y - numOfPoints * SPACING) / (numOfPoints + 1);

            const points = new Array(numOfPoints + 2);
            points[0] = p1;
            for (let i = 1; i <= numOfPoints; i++) {
                points[i] = {
                    x: p1.x + i * (x_step + SPACING),
                    y: p1.y + i * (y_step + SPACING),
                };
            }
            points[numOfPoints + 1] = p2;

            return points;
        }
    }

    /**
     * Remove currently active shape.
     *
     * @param {*} e
     * @param {?boolean} disableUndoRedo Disable undo/redo, as splitting
     *                                   has its own undo/redo code.
     * @returns {?ShapeModel} The removed shape, if disableUndoRedo is true.
     */
    removeActiveShape(e, disableUndoRedo = false) {
        if (window.cvat.mode === null) {
            this._model.selectShape(this._model.lastPosition, false);
            const { activeShape } = this._model;
            if (activeShape && (!activeShape.lock || e && e.shiftKey)) {
                const removedItem = activeShape.remove(disableUndoRedo);

                if (disableUndoRedo) {
                    return removedItem;
                }
            }
        }
    }

    resetPerspectiveFromActiveShape() {
        const { activeShape } = this._model;
        if (activeShape && activeShape instanceof CuboidModel) {
            this.activeShape.resetPerspective();
        }
    }

    switchOrientationFromActiveShape() {
        const { activeShape } = this._model;
        if (activeShape && activeShape instanceof CuboidModel) {
            this.activeShape.switchOrientation();
        }
    }

    removePointFromActiveShape(idx) {
        this._model.removePointFromActiveShape(idx);
    }

    splitForActive() {
        this._model.split();
    }

    /**
     * Given the position in the canvas, select a shape containing that position.
     * The position provided is mouse position, converted to canvas coordinate.
     *
     * @param {SVGPoint} pos Position in the canvas.
     * @param {boolean} noActivation Do not activate the shape.
     *                               When the mouse moves around, a shape may be selected, but not activated.
     *                               The shape is activated only if it is clicked.
     */
    selectShape(pos, noActivation) {
        this._model.selectShape(pos, noActivation);
    }

    /**
     * Deselect active shape.
     */
    resetActive() {
        this._model.resetActive();
    }

    /**
     * Set last position as the current mouse position, in canvas coordinate.
     *
     * @param {SVGPoint} pos The current mouse position.
     */
    setLastPosition(pos) {
        this._model.lastPosition = pos;
    }

    setShowAllInterpolation(value) {
        this._model.showAllInterpolation = value;
    }

    colorsByGroup(groupId) {
        return this._model.colorsByGroup(groupId);
    }

    get filterController() {
        return this._filterController;
    }

    get activeShape() {
        return this._model.activeShape;
    }
}

class ShapeCollectionView {
    /**
     *
     * @param {ShapeCollectionModel} collectionModel
     * @param {ShapeCollectionController} collectionController
     */
    constructor(collectionModel, collectionController) {
        collectionModel.subscribe(this);
        this._controller = collectionController;
        this._frameBackground = $('#frameBackground');
        this._frameContent = SVG.adopt($('#frameContent')[0]);
        this._textContent = SVG.adopt($('#frameText')[0]);
        this._UIContent = $('#uiContent');
        this._labelsContent = $('#labelsContent');
        this._showAllInterpolationBox = $('#showAllInterBox');
        this._fillOpacityRange = $('#fillOpacityRange');
        this._selectedFillOpacityRange = $('#selectedFillOpacityRange');
        this._blackStrokeCheckbox = $('#blackStrokeCheckbox');
        this._colorByInstanceRadio = $('#colorByInstanceRadio');
        this._colorByGroupRadio = $('#colorByGroupRadio');
        this._colorByLabelRadio = $('#colorByLabelRadio');
        this._colorByGroupCheckbox = $('#colorByGroupCheckbox');
        this._filterView = new FilterView(this._controller.filterController);
        this._enabledProjectionCheckbox = $('#projectionLineEnable');
        this._currentViews = [];

        this._currentModels = [];
        this._frameMarker = null;

        this._activeShapeUI = null;
        this._scale = 1;
        this._rotation = 0;
        this._colorSettings = {
            'fill-opacity': 0,
            'projection-lines': false,
        };

        this._showAllInterpolationBox.on('change', (e) => {
            this._controller.setShowAllInterpolation(e.target.checked);
        });

        this._fillOpacityRange.on('input', (e) => {
            let value = Math.clamp(+e.target.value, +e.target.min, +e.target.max);
            e.target.value = value;
            if (value >= 0) {
                this._colorSettings['fill-opacity'] = value;
                delete this._colorSettings['white-opacity'];

                for (const view of this._currentViews) {
                    view.updateColorSettings(this._colorSettings);
                }
            } else {
                value *= -1;
                this._colorSettings['white-opacity'] = value;

                for (const view of this._currentViews) {
                    view.updateColorSettings(this._colorSettings);
                }
            }
        });

        this._selectedFillOpacityRange.on('input', (e) => {
            const value = Math.clamp(+e.target.value, +e.target.min, +e.target.max);
            e.target.value = value;
            this._colorSettings['selected-fill-opacity'] = value;

            for (const view of this._currentViews) {
                view.updateColorSettings(this._colorSettings);
            }
        });

        this._blackStrokeCheckbox.on('click', (e) => {
            this._colorSettings['black-stroke'] = e.target.checked;

            for (const view of this._currentViews) {
                view.updateColorSettings(this._colorSettings);
            }
        });

        this._colorByInstanceRadio.on('change', () => {
            this._colorSettings['color-by-group'] = false;
            this._colorSettings['color-by-label'] = false;

            for (const view of this._currentViews) {
                view.updateColorSettings(this._colorSettings);
            }
        });

        this._colorByGroupRadio.on('change', () => {
            this._colorSettings['color-by-group'] = true;
            this._colorSettings['color-by-label'] = false;
            this._colorSettings['colors-by-group'] = this._controller.colorsByGroup.bind(this._controller);

            for (const view of this._currentViews) {
                view.updateColorSettings(this._colorSettings);
            }
        });

        this._colorByLabelRadio.on('change', () => {
            this._colorSettings['color-by-label'] = true;
            this._colorSettings['color-by-group'] = false;

            this._colorSettings['colors-by-label'] = this._controller.colorsByGroup.bind(this._controller);

            for (const view of this._currentViews) {
                view.updateColorSettings(this._colorSettings);
            }
        });

        this._enabledProjectionCheckbox.on('change', e => {
            this._colorSettings['projection-lines'] = e.target.checked;
            for (const view of this._currentViews) {
                view.updateColorSettings(this._colorSettings);
            }
        });

        this._frameContent.on('mousedown', (e) => {
            if (e.target === this._frameContent.node) {
                this._controller.resetActive();
            }
        });

        $('#playerFrame').on('mouseleave', () => {
            if (!window.cvat.mode) {
                this._controller.resetActive();
            }
        });

        this._frameContent.on('mousemove', (e) => {
            if (e.ctrlKey || e.which === 2 || e.target.classList.contains('svg_select_points')) {
                return;
            }

            const { frameWidth, frameHeight } = window.cvat.player.geometry;
            const pos = window.cvat.translate.point.clientToCanvas(this._frameBackground[0], e.clientX, e.clientY);
            if (pos.x >= 0 && pos.y >= 0 && pos.x <= frameWidth && pos.y <= frameHeight) {
                if (!window.cvat.mode) {
                    this._controller.selectShape(pos, false);
                }

                this._controller.setLastPosition(pos);
            }
        });

        $('#shapeContextMenu li').click((e) => {
            $('.custom-menu').hide(100);

            switch ($(e.target).attr('action')) {
            case 'object_url': {
                const active = this._controller.activeShape;
                if (active) {
                    if (typeof active.serverID !== 'undefined') {
                        window.cvat.search.set('frame', window.cvat.player.frames.current);
                        window.cvat.search.set('filter', `*[serverID="${active.serverID}"]`);
                        copyToClipboard(window.cvat.search.toString());
                        window.cvat.search.set('frame', null);
                        window.cvat.search.set('filter', null);
                    } else {
                        showMessage('First save job in order to get static object URL');
                    }
                }
                break;
            }
            case 'change_color':
                this._controller.switchActiveColor();
                break;
            case 'remove_shape':
                this._controller.removeActiveShape();
                break;
            case 'switch_occluded':
                this._controller.switchActiveOccluded();
                break;
            case 'switch_lock':
                this._controller.switchActiveLock();
                break;
            case 'split_track':
                this._controller.splitForActive();
                break;
            case 'drag_polygon':
                this._controller.switchDraggableForActive();
                break;
            case 'reset_perspective':
                this._controller.resetPerspectiveFromActiveShape();
                break;
            case 'switch_orientation':
                this._controller.switchOrientationFromActiveShape();
                break;
            case 'split_row':
                dialogSplitBox(true, false,
                    (row, col) => this._controller.splitActiveBox(row, col));
                break;
            case 'split_column':
                dialogSplitBox(false, true,
                    (row, col) => this._controller.splitActiveBox(row, col));
                break;
            case 'split_grid':
                dialogSplitBox(true, true,
                    (row, col) => this._controller.splitActiveBox(row, col));
                break;
            }
        });

        const { shortkeys } = window.cvat.config;
        for (const button of $('#shapeContextMenu li')) {
            switch (button.getAttribute('action')) {
            case 'change_color':
                button.innerText = `Change Color (${shortkeys.change_shape_color.view_value})`;
                break;
            case 'remove_shape':
                button.innerText = `Remove Shape (${shortkeys.delete_shape.view_value})`;
                break;
            case 'switch_occluded':
                button.innerText = `Switch Occluded (${shortkeys.switch_occluded_property.view_value})`;
                break;
            case 'switch_lock':
                button.innerText = `Switch Lock (${shortkeys.switch_lock_property.view_value})`;
                break;
            }
        }

        $('#pointContextMenu li').click((e) => {
            const menu = $('#pointContextMenu');
            const idx = +menu.attr('point_idx');
            $('.custom-menu').hide(100);

            switch ($(e.target).attr('action')) {
            case 'remove_point':
                this._controller.removePointFromActiveShape(idx);
                break;
            }
        });

        const labels = window.cvat.labelsInfo.labels();
        for (const labelId in labels) {
            const lockButton = $('<button> </button>')
                .addClass('graphicButton lockButton')
                .attr('title', 'Switch lock for all object with same label')
                .on('click', () => {
                    this._controller.switchLabelLock(+labelId);
                });

            lockButton[0].updateState = function (button, labelId) {
                const models = this._currentModels.filter((el) => el.label === labelId);
                let locked = true;
                for (const model of models) {
                    locked = locked && model.lock;
                    if (!locked) {
                        break;
                    }
                }

                if (!locked) {
                    button.removeClass('locked');
                } else {
                    button.addClass('locked');
                }
            }.bind(this, lockButton, +labelId);

            const hiddenButton = $('<button> </button>')
                .addClass('graphicButton hiddenButton')
                .attr('title', 'Switch hide for all object with same label')
                .on('click', () => {
                    this._controller.switchLabelHide(+labelId);
                });

            hiddenButton[0].updateState = function (button, labelId) {
                const models = this._currentModels.filter((el) => el.label === labelId);
                let hiddenShape = true;
                let hiddenText = true;
                for (const model of models) {
                    hiddenShape = hiddenShape && model.hiddenShape;
                    hiddenText = hiddenText && model.hiddenText;
                    if (!hiddenShape && !hiddenText) {
                        break;
                    }
                }

                if (hiddenShape) {
                    button.removeClass('hiddenText');
                    button.addClass('hiddenShape');
                } else if (hiddenText) {
                    button.addClass('hiddenText');
                    button.removeClass('hiddenShape');
                } else {
                    button.removeClass('hiddenText hiddenShape');
                }
            }.bind(this, hiddenButton, +labelId);

            const buttonBlock = $('<center> </center>')
                .append(lockButton)
                .append(hiddenButton)
                .addClass('buttonBlockOfLabelUI');

            const title = $(`<label> ${labels[labelId]} </label>`);

            const mainDiv = $('<div> </div>').addClass('labelContentElement h2 regular hidden')
                .css({
                    'background-color': collectionController.colorsByGroup(+window.cvat.labelsInfo.labelColorIdx(+labelId)),
                })
                .attr({
                    label_id: labelId,
                })
                .on('mouseover mouseup', () => {
                    mainDiv.addClass('highlightedUI');
                    collectionModel.selectAllWithLabel(+labelId);
                })
                .on('mouseout mousedown', () => {
                    mainDiv.removeClass('highlightedUI');
                    collectionModel.deselectAll();
                })
                .append(title)
                .append(buttonBlock);

            mainDiv[0].updateState = function () {
                lockButton[0].updateState();
                hiddenButton[0].updateState();
            };

            this._labelsContent.append(mainDiv);
        }

        const sidePanelObjectsButton = $('#sidePanelObjectsButton');
        const sidePanelLabelsButton = $('#sidePanelLabelsButton');

        sidePanelObjectsButton.on('click', () => {
            sidePanelObjectsButton.addClass('activeTabButton');
            sidePanelLabelsButton.removeClass('activeTabButton');
            this._UIContent.removeClass('hidden');
            this._labelsContent.addClass('hidden');
        });

        sidePanelLabelsButton.on('click', () => {
            sidePanelLabelsButton.addClass('activeTabButton');
            sidePanelObjectsButton.removeClass('activeTabButton');
            this._labelsContent.removeClass('hidden');
            this._UIContent.addClass('hidden');
        });

        /**
         * Ask user the number of row and column to split.
         *
         * @param {boolean} splitIntoRow Split into row or not.
         * @param {boolean} splitIntoCol Split into column or not.
         * @param {ShapeCollectionController~splitActiveBox} onOK Callback to split box.
         */
        function dialogSplitBox(splitIntoRow, splitIntoCol, onOK) {
            const template = $('#splitBoxTemplate');
            const messageWindow = $(template.html()).css('display', 'block');    // Why .html()?

            const messageText = messageWindow.find('.templateMessage');
            const rowInput = messageWindow.find('span.row-input');
            const colInput = messageWindow.find('span.col-input');

            if (!splitIntoRow && !splitIntoCol) {
                throw Error('Unreachable code was reached.');
            } else if (splitIntoRow && splitIntoCol) {
                messageText.text('Set the number of row and column to split:');
            } else if (!splitIntoRow) {    // row and col can't both be false.
                messageText.text('Set the number of column to split:');
                rowInput.css('display', 'none');
            } else {
                messageText.text('Set the number of row to split:');
                colInput.hide();
            }
            rowInput.on('click', e => $(e).select());
            colInput.on('click', e => $(e).select());

            $('body').append(messageWindow);

            // Restore original state upon removal: inputs shown, errors hidden.
            // messageWindow.on('remove', () => {
            //     rowInput.show();
            //     colInput.show();
            //     messageWindow.find('span > p').hide();
            //     messageWindow.off('remove');
            // });

            // Prevent bubbling of keyboard event, so that tabbing
            // between element is possible.
            messageWindow.on('keydown', e => e.stopPropagation());

            const okButton = messageWindow.find('.templateOKButton');
            okButton.on('click', () => {
                let row = 1; let col = 1;
                let error = false;

                messageWindow
                    .find('span > input')
                    .filter(':visible')
                    .each((_, el) => {
                        el = $(el);
                        const val = parseInt(el.val(), 10);

                        if (!val || val < 1 || val > 20) {
                            error = true;
                            el.next().show();
                        }

                        const isRowInput = el.attr('name') === 'row';
                        if (isRowInput) row = val;
                        else col = val;
                    });

                if (!error) {
                    okButton.off('click');    // Why?
                    messageWindow.remove();
                    if (onOK) onOK(row, col);
                }
            });

            const cancelButton = messageWindow.find('.templateCancelButton');
            cancelButton.on('click', () => messageWindow.remove());

            // Focus at the first input field
            // Why must setTimeout()?
            setTimeout(() => messageWindow.find('.modal-content input').filter(':visible').first().select());
        }
    }

    _updateLabelUIs() {
        this._labelsContent.find('.labelContentElement').addClass('hidden');
        const labels = new Set(this._currentModels.map((el) => el.label));
        for (const label of labels) {
            this._labelsContent.find(`.labelContentElement[label_id="${label}"]`).removeClass('hidden');
        }
        this._updateLabelUIsState();
    }

    _updateLabelUIsState() {
        for (const labelUI of this._labelsContent.find('.labelContentElement').not('.hidden')) {
            labelUI.updateState();
        }
    }

    /**
     * Callback used to receive update from ShapeCollectionModel.
     * The ShapeCollectionModel (the publisher) is modified here. The _frameContent and _UIContent is detached, but not deleted,
     * so subsequent calls can continue to update it and finally attach (append()) it when appropriate.
     *
     * @param {ShapeCollectionModel} collection Current ShapeCollectionModel.
     */
    onCollectionUpdate(collection) {
        // Save parents and detach elements from DOM
        // in order to increase performance in the buildShapeView function (ol' trick of drawing on hidden element to avoid reflow)
        const parents = {
            uis: this._UIContent.parent(),
            shapes: this._frameContent.node.parentNode,
        };

        const oldModels = this._currentModels;
        const oldViews = this._currentViews;
        const newShapes = collection.currentShapes;
        const newModels = newShapes.map((el) => el.model);

        const frameChanged = this._frameMarker !== window.cvat.player.frames.current;
        this._scale = window.cvat.player.geometry.scale;

        if (frameChanged) {
            this._frameContent.node.parent = null;
            this._UIContent.detach();
        }

        this._currentViews = [];
        this._currentModels = [];

        // Check which old models are new models
        for (let oldIdx = 0; oldIdx < oldModels.length; oldIdx++) {
            const newIdx = newModels.indexOf(oldModels[oldIdx]);
            const significantUpdate = ['remove', 'keyframe', 'outside'].includes(oldModels[oldIdx].updateReason);

            // Changed frame means a changed position in common case. We need redraw it.
            // If shape has been restored after removing, it view already removed. We need redraw it.
            if (newIdx === -1 || significantUpdate || frameChanged) {
                const view = oldViews[oldIdx];
                view.unsubscribe(this);
                view.controller().model().unsubscribe(view);
                view.erase();

                if (newIdx != -1 && (frameChanged || significantUpdate)) {
                    drawView.call(this, newShapes[newIdx], newModels[newIdx]);
                }
            } else {
                this._currentViews.push(oldViews[oldIdx]);
                this._currentModels.push(oldModels[oldIdx]);
            }
        }

        // Now we need draw new models which aren't on previous collection. At this point, all shapes are loaded.
        for (let newIdx = 0; newIdx < newModels.length; newIdx++) {
            if (!this._currentModels.includes(newModels[newIdx])) {
                drawView.call(this, newShapes[newIdx], newModels[newIdx]);
            }
        }

        if (frameChanged) {
            parents.shapes.append(this._frameContent.node);    // After drawing, reattach.
            parents.uis.prepend(this._UIContent);
        }

        ShapeCollectionView.sortByZOrder();
        this._frameMarker = window.cvat.player.frames.current;
        this._updateLabelUIs();

        /**
         * Draw view, and add it to the list of views.
         * Why does model has to be passed when it is already bundled in shape/
         *
         * @param {{model: ShapeModel, interpolation: ShapeInFrame}} shape Calculated shape information, ready to draw.
         * @param {ShapeModel} model Shape model (the same as shape.model?).
         */
        function drawView(shape, model) {
            const view = buildShapeView(model, buildShapeController(model), this._frameContent, this._UIContent, this._textContent);
            view.draw(shape.interpolation);
            view.updateColorSettings(this._colorSettings);
            model.subscribe(view);
            view.subscribe(this);
            this._currentViews.push(view);
            this._currentModels.push(model);
        }
    }

    onPlayerUpdate(player) {
        if (!player.ready()) this._frameContent.addClass('hidden');
        else this._frameContent.removeClass('hidden');

        const { geometry } = player;
        if (this._rotation != geometry.rotation) {
            this._rotation = geometry.rotation;
            this._controller.resetActive();
        }

        if (this._scale === geometry.scale) return;

        this._scale = player.geometry.scale;
        const scaledR = POINT_RADIUS / this._scale;
        const scaledStroke = STROKE_WIDTH / this._scale;
        const scaledPointStroke = SELECT_POINT_STROKE_WIDTH / this._scale;

        $('.svg_select_points').each(function () {
            this.instance.radius(scaledR, scaledR);
            this.instance.attr('stroke-width', scaledPointStroke);
        });

        $('.tempMarker').each(function () {
            this.instance.radius(scaledR, scaledR);
            this.instance.attr('stroke-width', scaledStroke);
        });

        for (const view of this._currentViews) {
            view.updateShapeTextPosition();
        }
    }

    /**
     * Callback for ShapeView.
     *
     * @param {ShapeView} view View of the updated shape.
     */
    onShapeViewUpdate(view) {
        switch (view.updateReason) {
        case 'drag':
            if (view.dragging) {
                window.cvat.mode = 'drag';
            } else if (window.cvat.mode === 'drag') {
                window.cvat.mode = null;
            }
            break;
        case 'resize':
            if (view.resize) {
                window.cvat.mode = 'resize';
            } else if (window.cvat.mode === 'resize') {
                window.cvat.mode = null;
            }
            break;
        case 'remove': {
            const idx = this._currentViews.indexOf(view);
            view.unsubscribe(this);
            view.controller().model().unsubscribe(view);
            view.erase();
            this._currentViews.splice(idx, 1);
            this._currentModels.splice(idx, 1);
            this._updateLabelUIs();
            break;
        }
        case 'changelabel': {
            this._updateLabelUIs();
            break;
        }
        case 'lock':
            this._updateLabelUIsState();
            break;
        case 'hidden':
            this._updateLabelUIsState();
            break;
        }
    }

    // If ShapeGrouperModel was disabled, need to update shape appearance
    // In order to don't duplicate function, I simulate checkbox change event
    onGrouperUpdate(grouper) {
        if (!grouper.active && this._colorByGroupRadio.prop('checked')) {
            this._colorByGroupRadio.trigger('change');
        }
    }

    static sortByZOrder() {
        if (window.cvat.job.z_order) {
            const content = $('#frameContent');
            const shapes = $(content.find('.shape, .pointTempGroup, .shapeCreation, .aim').toArray().sort(
                (a, b) => (+a.attributes.z_order.nodeValue - +b.attributes.z_order.nodeValue),
            ));
            const children = content.children().not(shapes);

            for (const shape of shapes) {
                content.append(shape);
            }

            for (const child of children) {
                content.append(child);
            }
        }
    }
}
