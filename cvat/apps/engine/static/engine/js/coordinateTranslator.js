/* eslint-disable array-bracket-spacing */
/* eslint-disable comma-spacing */
/* eslint-disable no-multi-spaces */
/*
 * Copyright (C) 2018 Intel Corporation
 *
 * SPDX-License-Identifier: MIT
 */

/* exported CoordinateTranslator */

'use strict';

/**
 * No function modifies the input object in place, except the dash (for internal use).
 * There're 2 types of shape data, and only differ in how the coordinate is stored:
 *   - Server
 *   - Client
 * There're 3 types of coordinate:
 *   - Image ("actual" in the code): for storing shape data. Naturally, client and
 *    server shapes use this coordinate system.
 *   - Canvas: for drawing data. Even worse, but obviously, each canvas has its own
 *    coordinate system:
 *     + #frameBackground: Same origin, pixel size,... as Image, but allows for
 *       negative coordinate. The element itself holds the image.
 *     + #frameContent, #playerFrame: 30000-ish width and height, used to actually
 *       draw UI in _drawShapeUI(). Conversion uses _playerOffset.
 *   - Viewport (also refer to as "client"): for processing mouse event. Notably,
 *     there're also page coordinate, and screen coordinate. These 2 coordinates
 *     is not used in this project, but can (did) cause serious confusion.
 */
class CoordinateTranslator {
    constructor() {
        this._boxTranslator = {
            _playerOffset: 0,

            /**
             * Convert between canvas and image coordinate.
             *
             * @param {BoxPosition} box Box data.
             * @param {number} sign 1 for image to canvas, -1 the other way.
             * @returns {BoxPosition} Converted box data.
             */
            _convert(box, sign) {
                const offset = this._playerOffset * sign;
                for (const prop of ['xtl', 'ytl', 'xbr', 'ybr', 'x', 'y']) {
                    if (prop in box) {
                        box[prop] += offset;
                    }
                }
                return box;
            },

            /**
             * Convert client box data, in image coordinate, to canvas coordinate.
             *
             * @param {BoxPosition} actualBox Client box data in image coordinate.
             * @returns {BoxPosition} Client box data, converted to canvas coordinate.
             */
            actualToCanvas(actualBox) {
                const canvasBox = {};
                for (const key in actualBox) {
                    canvasBox[key] = actualBox[key];
                }
                return this._convert(canvasBox, 1);
            },

            /**
             * The reverse of actualToCanvas().
             *
             * @param {BoxPosition} canvasBox Client box data in canvas coordinate.
             * @returns {BoxPosition} Client box data, converted to image coordinate.
             */
            canvasToActual(canvasBox) {
                const actualBox = {};
                for (const key in canvasBox) {
                    actualBox[key] = canvasBox[key];
                }
                return this._convert(actualBox, -1);
            },

            /**
             * Convert canvas box to viewport box.
             *
             * @param {SVGElement} sourceCanvas Source canvas.
             * @param {SVGRect} canvasBox Canvas box data.
             * @returns {{x: number, y: number, width: number, height: number}} Box position in viewport coordinate,
             *                                                                  same structure as SVGRect.
             */
            canvasToClient(sourceCanvas, canvasBox) {
                const points = [
                    [canvasBox.x                  , canvasBox.y                   ],
                    [canvasBox.x + canvasBox.width, canvasBox.y                   ],
                    [canvasBox.x                  , canvasBox.y + canvasBox.height],
                    [canvasBox.x + canvasBox.width, canvasBox.y + canvasBox.height],
                ].map(el => window.cvat.translate.point.canvasToClient(sourceCanvas, ...el));

                const xes = points.map(el => el.x);
                const yes = points.map(el => el.y);

                const xmin = Math.min(...xes);
                const xmax = Math.max(...xes);
                const ymin = Math.min(...yes);
                const ymax = Math.max(...yes);

                return {
                    x: xmin,
                    y: ymin,
                    width: xmax - xmin,
                    height: ymax - ymin,
                };
            },

            /**
             * Convert server point format to client point format.
             *
             * @param {Object} shape Server raw data.
             * @returns {{xtl: number, ytl: number, xbr: number, ybr: number}} Client box position.
             */
            serverToClient(shape) {
                return {
                    xtl: shape.points[0],
                    ytl: shape.points[1],
                    xbr: shape.points[2],
                    ybr: shape.points[3],
                };
            },

            /**
             * The reverse of serverToClient().
             *
             * @param {Object} clientObject Client box data.
             * @returns {{points: number[]}} Server box position.
             */
            clientToServer(clientObject) {
                return {
                    points: [clientObject.xtl, clientObject.ytl,
                        clientObject.xbr, clientObject.ybr],
                };
            },
        };

        this._pointsTranslator = {
            _playerOffset: 0,

            /**
             * Convert between canvas and image coordinate.
             *
             * @param {string|Object} points Points data.
             * @param {number} sign 1 for image to canvas, -1 the other way.
             * @returns {string|Object} Converted points data.
             */
            _convert(points, sign) {
                const offset = this._playerOffset * sign;
                if (typeof (points) === 'string') {
                    return points
                        .split(' ')
                        .map(coord => coord
                            .split(',')
                            .map(x => +x + offset)
                            .join(','))
                        .join(' ');
                }
                if (typeof (points) === 'object') {
                    return points.map(point => ({
                        x: point.x + offset,
                        y: point.y + offset,
                    }));
                }
                throw Error('Unknown points type was found');
            },

            /**
             * Convert client points data, in image coordinate, to canvas coordinate.
             *
             * @param {string|Object} actualPoints Client points data in image coordinate.
             * @returns {string|Object} Client points data, converted to canvas coordinate.
             */
            actualToCanvas(actualPoints) {
                return this._convert(actualPoints, 1);
            },

            /**
             * The reverse of actualToCanvas().
             *
             * @param {string|Object} actualPoints Client points data in canvas coordinate.
             * @returns {string|Object} Client points data, converted to image coordinate.
             */
            canvasToActual(canvasPoints) {
                return this._convert(canvasPoints, -1);
            },

            /**
             * Convert server points format to client points format.
             *
             * @param {Object} shape Server raw data.
             * @returns {{points: string}} Points data of the shape, serialized in this format:
             *                             'x0,y0 x1,y1...'
             */
            serverToClient(shape) {
                return {
                    points: shape.points
                        .reduce((acc, _, idx, src) => {
                            // Add 2 consecutive values in even idx, do nothing otherwise.
                            if (idx % 2 === 0) {
                                acc.push([src[idx], src[idx + 1]]);
                            }

                            // Array of point coordinate, each element is [x, y]
                            return acc;
                        }, [])
                        .map(pointCoordinates => pointCoordinates.join(','))
                        .join(' '),
                };
            },

            /**
             * The reverse of serverToClient().
             *
             * @param {Object} clientPoints Client points data.
             * @returns {{points: number[]}} Server points data, deserialized into an array in this format:
             *                                 [x0, y0, x1, y1,...]
             */
            clientToServer(clientPoints) {
                return {
                    points: clientPoints.points
                        .split(' ')
                        .join(',')
                        .split(',')
                        .map(x => +x),
                };
            },
        };

        this._pointTranslator = {
            _rotation: 0,

            /**
             * Convert viewport coordinate to canvas coordinate.
             * https://www.w3.org/TR/css-transforms-1/#current-transformation-matrix
             * CTM maps a "local" coordinate system to viewport coordinate system.
             * This functions attempts to do the reverse, so inverse() of CTM is used.
             *
             * @param {SVGElement} targetCanvas Target canvas.
             * @param {number} clientX x-coordinate of a point in viewport.
             * @param {number} clientY y-coordinate of a point in viewport.
             * @returns {SVGPoint} Point in canvas coordinate.
             */
            clientToCanvas(targetCanvas, clientX, clientY) {
                let pt = targetCanvas.createSVGPoint();
                pt.x = clientX;
                pt.y = clientY;
                pt = pt.matrixTransform(targetCanvas.getScreenCTM().inverse());
                return pt;
            },

            /**
             * The reverse of clientToCanvas().
             *
             * @param {SVGElement} sourceCanvas Source canvas.
             * @param {number} canvasX x-coordinate of a point in canvas.
             * @param {number} canvasY y-coordinate of a point in canvas.
             * @returns {SVGPoint} Point in viewport coordinate.
             */
            canvasToClient(sourceCanvas, canvasX, canvasY) {
                let pt = sourceCanvas.createSVGPoint();
                pt.x = canvasX;
                pt.y = canvasY;
                pt = pt.matrixTransform(sourceCanvas.getScreenCTM());
                return pt;
            },

            rotate(x, y, cx, cy) {
                cx = (typeof cx === 'undefined' ? 0 : cx);
                cy = (typeof cy === 'undefined' ? 0 : cy);

                const radians = (Math.PI / 180) * window.cvat.player.rotation;
                const cos = Math.cos(radians);
                const sin = Math.sin(radians);

                return {
                    x: cos * (x - cx) + sin * (y - cy) + cx,
                    y: cos * (y - cy) - sin * (x - cx) + cy,
                };
            },
        };
    }

    get box() {
        return this._boxTranslator;
    }

    get points() {
        return this._pointsTranslator;
    }

    get point() {
        return this._pointTranslator;
    }

    set playerOffset(value) {
        this._boxTranslator._playerOffset = value;
        this._pointsTranslator._playerOffset = value;
    }

    set rotation(value) {
        this._pointTranslator._rotation = value;
    }
}
