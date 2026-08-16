/**
 * ArcEditor SVG to ExtendScript / Shape Layer Transpiler
 * Parses SVG elements, normalizes complex path mini-language commands (M, L, H, V, C, S, Q, T, A, Z),
 * converts arcs/quadratics to cubic beziers, computes AE relative tangents, and generates
 * structured Shape Layer Intermediate Representation (IR) and ExtendScript JSX code.
 */

(function (root, factory) {
    var transpilerInstance = factory();

    // 1. Always bind to window / root in browser and CEP mixed-context environments
    if (typeof window !== 'undefined') {
        window.ArcSvgTranspiler = transpilerInstance;
        window.ArcEditor = window.ArcEditor || {};
        window.ArcEditor.svgTranspiler = transpilerInstance;
    }
    if (typeof root !== 'undefined') {
        root.ArcSvgTranspiler = transpilerInstance;
    }

    // 2. Also export to CommonJS for Node.js test environments
    if (typeof module === 'object' && module && module.exports) {
        module.exports = transpilerInstance;
    }
}(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
    'use strict';

    // Cubic bezier circle approximation constant (4/3 * (sqrt(2) - 1))
    var KAPPA = 0.5522847498307935;

    // Standard CSS color name map
    var CSS_COLORS = {
        black: [0, 0, 0],
        white: [1, 1, 1],
        red: [1, 0, 0],
        green: [0, 0.502, 0],
        blue: [0, 0, 1],
        yellow: [1, 1, 0],
        cyan: [0, 1, 1],
        magenta: [1, 0, 1],
        gray: [0.502, 0.502, 0.502],
        grey: [0.502, 0.502, 0.502],
        lightgray: [0.827, 0.827, 0.827],
        lightgrey: [0.827, 0.827, 0.827],
        darkgray: [0.663, 0.663, 0.663],
        darkgrey: [0.663, 0.663, 0.663],
        orange: [1, 0.647, 0],
        purple: [0.502, 0, 0.502],
        pink: [1, 0.753, 0.796],
        lime: [0, 1, 0],
        navy: [0, 0, 0.502],
        teal: [0, 0.502, 0.502],
        olive: [0.502, 0.502, 0],
        maroon: [0.502, 0, 0],
        gold: [1, 0.843, 0],
        silver: [0.753, 0.753, 0.753],
        coral: [1, 0.498, 0.314],
        salmon: [0.98, 0.502, 0.447],
        indigo: [0.294, 0, 0.51]
    };

    /**
     * Color Parser: parses hex, rgb, rgba, hsl, hsla, and named CSS colors into [r, g, b] (0..1) + opacity (0..100)
     */
    function parseColor(str) {
        if (!str || typeof str !== 'string') return null;
        var trimmed = str.trim();
        // Check if URL reference to a gradient: url(#gradId) - preserve exact case
        var gradMatch = trimmed.match(/url\(\s*['"]?#([^'"]+)['"]?\s*\)/i);
        if (gradMatch) {
            return { gradientId: gradMatch[1] };
        }

        var s = trimmed.toLowerCase();
        if (s === 'none' || s === 'transparent') return { none: true };

        // Named colors
        if (CSS_COLORS[s]) {
            var c = CSS_COLORS[s];
            return { rgb: [c[0], c[1], c[2]], opacity: 100 };
        }

        // Hex colors
        if (s.charAt(0) === '#') {
            var hex = s.substring(1);
            var r = 0, g = 0, b = 0, a = 100;
            if (hex.length === 3) {
                r = parseInt(hex.charAt(0) + hex.charAt(0), 16) / 255;
                g = parseInt(hex.charAt(1) + hex.charAt(1), 16) / 255;
                b = parseInt(hex.charAt(2) + hex.charAt(2), 16) / 255;
            } else if (hex.length === 4) {
                r = parseInt(hex.charAt(0) + hex.charAt(0), 16) / 255;
                g = parseInt(hex.charAt(1) + hex.charAt(1), 16) / 255;
                b = parseInt(hex.charAt(2) + hex.charAt(2), 16) / 255;
                a = (parseInt(hex.charAt(3) + hex.charAt(3), 16) / 255) * 100;
            } else if (hex.length === 6) {
                r = parseInt(hex.substring(0, 2), 16) / 255;
                g = parseInt(hex.substring(2, 4), 16) / 255;
                b = parseInt(hex.substring(4, 6), 16) / 255;
            } else if (hex.length === 8) {
                r = parseInt(hex.substring(0, 2), 16) / 255;
                g = parseInt(hex.substring(2, 4), 16) / 255;
                b = parseInt(hex.substring(4, 6), 16) / 255;
                a = (parseInt(hex.substring(6, 8), 16) / 255) * 100;
            }
            return {
                rgb: [round4(r), round4(g), round4(b)],
                opacity: round2(a)
            };
        }

        // RGB / RGBA
        var rgbMatch = s.match(/^rgba?\s*\(\s*([0-9.]+%?)\s*,\s*([0-9.]+%?)\s*,\s*([0-9.]+%?)(?:\s*,\s*([0-9.]+))?\s*\)$/);
        if (rgbMatch) {
            var parseCh = function (v) {
                if (v.indexOf('%') !== -1) {
                    return parseFloat(v) / 100;
                }
                return parseFloat(v) / 255;
            };
            var cr = parseCh(rgbMatch[1]);
            var cg = parseCh(rgbMatch[2]);
            var cb = parseCh(rgbMatch[3]);
            var ca = rgbMatch[4] !== undefined ? parseFloat(rgbMatch[4]) * 100 : 100;
            return {
                rgb: [round4(cr), round4(cg), round4(cb)],
                opacity: round2(ca)
            };
        }

        // HSL / HSLA
        var hslMatch = s.match(/^hsla?\s*\(\s*([0-9.]+)\s*,\s*([0-9.]+)%\s*,\s*([0-9.]+)%(?:\s*,\s*([0-9.]+))?\s*\)$/);
        if (hslMatch) {
            var h = parseFloat(hslMatch[1]) / 360;
            var sat = parseFloat(hslMatch[2]) / 100;
            var l = parseFloat(hslMatch[3]) / 100;
            var alpha = hslMatch[4] !== undefined ? parseFloat(hslMatch[4]) * 100 : 100;
            var rgb = hslToRgb(h, sat, l);
            return {
                rgb: [round4(rgb[0]), round4(rgb[1]), round4(rgb[2])],
                opacity: round2(alpha)
            };
        }

        return null;
    }

    function hslToRgb(h, s, l) {
        var r, g, b;
        if (s === 0) {
            r = g = b = l;
        } else {
            var hue2rgb = function (p, q, t) {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1 / 6) return p + (q - p) * 6 * t;
                if (t < 1 / 2) return q;
                if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
                return p;
            };
            var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            var p = 2 * l - q;
            r = hue2rgb(p, q, h + 1 / 3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1 / 3);
        }
        return [r, g, b];
    }

    function round4(n) {
        return Math.round(n * 10000) / 10000;
    }

    function round2(n) {
        return Math.round(n * 100) / 100;
    }

    /**
     * SVG Path Command Tokenizer
     * Handles compact number formats like "M10-20L.5.3e2"
     */
    function tokenizePath(d) {
        if (!d) return [];
        var tokens = [];
        var regex = /([a-df-z])|([-+]?(?:[0-9]*\.[0-9]+|[0-9]+)(?:[eE][-+]?[0-9]+)?)/gi;
        var match;
        while ((match = regex.exec(d)) !== null) {
            if (match[1]) {
                tokens.push({ type: 'cmd', val: match[1] });
            } else if (match[2]) {
                tokens.push({ type: 'num', val: parseFloat(match[2]) });
            }
        }
        return tokens;
    }

    /**
     * Elliptical Arc to Cubic Beziers (W3C SVG implementation standard)
     */
    function arcToBeziers(x1, y1, rx, ry, phiDeg, largeArc, sweep, x2, y2) {
        if (x1 === x2 && y1 === y2) return [];
        if (rx === 0 || ry === 0) {
            return [{ type: 'L', p: [x2, y2] }];
        }

        rx = Math.abs(rx);
        ry = Math.abs(ry);
        var phi = (phiDeg * Math.PI) / 180;
        var cosPhi = Math.cos(phi);
        var sinPhi = Math.sin(phi);

        // Step 1: Compute (x1', y1')
        var dx = (x1 - x2) / 2;
        var dy = (y1 - y2) / 2;
        var x1p = cosPhi * dx + sinPhi * dy;
        var y1p = -sinPhi * dx + cosPhi * dy;

        // Correct radii if too small
        var lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
        if (lambda > 1) {
            var sqrtLambda = Math.sqrt(lambda);
            rx *= sqrtLambda;
            ry *= sqrtLambda;
        }

        // Step 2: Compute (cx', cy')
        var sign = (largeArc === sweep) ? -1 : 1;
        var num = (rx * rx * ry * ry) - (rx * rx * y1p * y1p) - (ry * ry * x1p * x1p);
        var den = (rx * rx * y1p * y1p) + (ry * ry * x1p * x1p);
        var factor = sign * Math.sqrt(Math.max(0, num / den));
        var cxp = factor * ((rx * y1p) / ry);
        var cyp = factor * (-(ry * x1p) / rx);

        // Step 3: Compute (cx, cy) from (cx', cy')
        var cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
        var cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

        // Step 4: Compute theta1 and deltaTheta
        var v1x = (x1p - cxp) / rx;
        var v1y = (y1p - cyp) / ry;
        var v2x = (-x1p - cxp) / rx;
        var v2y = (-y1p - cyp) / ry;

        var vectorAngle = function (ux, uy, vx, vy) {
            var dot = ux * vx + uy * vy;
            var len = Math.sqrt(ux * ux + uy * uy) * Math.sqrt(vx * vx + vy * vy);
            var ang = Math.acos(Math.max(-1, Math.min(1, dot / len)));
            if ((ux * vy - uy * vx) < 0) ang = -ang;
            return ang;
        };

        var theta1 = vectorAngle(1, 0, v1x, v1y);
        var deltaTheta = vectorAngle(v1x, v1y, v2x, v2y);

        if (!sweep && deltaTheta > 0) {
            deltaTheta -= 2 * Math.PI;
        } else if (sweep && deltaTheta < 0) {
            deltaTheta += 2 * Math.PI;
        }

        // Subdivide arc into segments <= PI/2
        var segments = Math.max(1, Math.ceil(Math.abs(deltaTheta) / (Math.PI / 2)));
        var dTheta = deltaTheta / segments;
        var beziers = [];

        var curTheta = theta1;
        var curX = x1;
        var curY = y1;

        for (var i = 0; i < segments; i++) {
            var nextTheta = curTheta + dTheta;
            var alpha = (4 / 3) * Math.tan(dTheta / 4);

            var cosT1 = Math.cos(curTheta);
            var sinT1 = Math.sin(curTheta);
            var cosT2 = Math.cos(nextTheta);
            var sinT2 = Math.sin(nextTheta);

            var e1x = -rx * sinT1;
            var e1y = ry * cosT1;
            var e2x = -rx * sinT2;
            var e2y = ry * cosT2;

            var cp1xPrime = rx * cosT1 + alpha * e1x;
            var cp1yPrime = ry * sinT1 + alpha * e1y;
            var cp2xPrime = rx * cosT2 - alpha * e2x;
            var cp2yPrime = ry * sinT2 - alpha * e2y;
            var p2xPrime = rx * cosT2;
            var p2yPrime = ry * sinT2;

            // Transform back
            var cp1x = cosPhi * cp1xPrime - sinPhi * cp1yPrime + cx;
            var cp1y = sinPhi * cp1xPrime + cosPhi * cp1yPrime + cy;
            var cp2x = cosPhi * cp2xPrime - sinPhi * cp2yPrime + cx;
            var cp2y = sinPhi * cp2xPrime + cosPhi * cp2yPrime + cy;
            var p2x = (i === segments - 1) ? x2 : (cosPhi * p2xPrime - sinPhi * p2yPrime + cx);
            var p2y = (i === segments - 1) ? y2 : (sinPhi * p2xPrime + cosPhi * p2yPrime + cy);

            beziers.push({
                type: 'C',
                cp1: [cp1x, cp1y],
                cp2: [cp2x, cp2y],
                p: [p2x, p2y]
            });

            curTheta = nextTheta;
            curX = p2x;
            curY = p2y;
        }

        return beziers;
    }

    /**
     * Parses SVG path data string into normalized cubic bezier segments and subpaths
     */
    function parsePathData(d) {
        var tokens = tokenizePath(d);
        if (tokens.length === 0) return [];

        var subpaths = [];
        var curSubpath = null;
        var curX = 0, curY = 0;
        var startX = 0, startY = 0;
        var lastCp2 = null;
        var lastQuadCp = null;
        var i = 0;
        var curCmd = 'M';

        var nextNum = function () {
            if (i < tokens.length && tokens[i].type === 'num') {
                return tokens[i++].val;
            }
            return 0;
        };

        var hasMoreNums = function () {
            return i < tokens.length && tokens[i].type === 'num';
        };

        while (i < tokens.length) {
            if (tokens[i].type === 'cmd') {
                curCmd = tokens[i++].val;
            }

            var isRel = (curCmd === curCmd.toLowerCase());
            var cmdUpper = curCmd.toUpperCase();

            if (cmdUpper === 'M') {
                var mx = nextNum();
                var my = nextNum();
                if (isRel && curSubpath) {
                    mx += curX;
                    my += curY;
                }
                curX = mx;
                curY = my;
                startX = mx;
                startY = my;
                lastCp2 = null;
                lastQuadCp = null;

                curSubpath = {
                    startX: startX,
                    startY: startY,
                    segments: [],
                    closed: false
                };
                subpaths.push(curSubpath);

                // Subsequent pairs treated as L/l
                curCmd = isRel ? 'l' : 'L';
            } else if (cmdUpper === 'L') {
                while (hasMoreNums()) {
                    var lx = nextNum();
                    var ly = nextNum();
                    if (isRel) {
                        lx += curX;
                        ly += curY;
                    }
                    if (curSubpath) {
                        curSubpath.segments.push({
                            type: 'L',
                            p: [lx, ly]
                        });
                    }
                    curX = lx;
                    curY = ly;
                    lastCp2 = null;
                    lastQuadCp = null;
                }
            } else if (cmdUpper === 'H') {
                while (hasMoreNums()) {
                    var hx = nextNum();
                    if (isRel) hx += curX;
                    if (curSubpath) {
                        curSubpath.segments.push({
                            type: 'L',
                            p: [hx, curY]
                        });
                    }
                    curX = hx;
                    lastCp2 = null;
                    lastQuadCp = null;
                }
            } else if (cmdUpper === 'V') {
                while (hasMoreNums()) {
                    var vy = nextNum();
                    if (isRel) vy += curY;
                    if (curSubpath) {
                        curSubpath.segments.push({
                            type: 'L',
                            p: [curX, vy]
                        });
                    }
                    curY = vy;
                    lastCp2 = null;
                    lastQuadCp = null;
                }
            } else if (cmdUpper === 'C') {
                while (hasMoreNums()) {
                    var x1 = nextNum(), y1 = nextNum();
                    var x2 = nextNum(), y2 = nextNum();
                    var x = nextNum(), y = nextNum();
                    if (isRel) {
                        x1 += curX; y1 += curY;
                        x2 += curX; y2 += curY;
                        x += curX; y += curY;
                    }
                    if (curSubpath) {
                        curSubpath.segments.push({
                            type: 'C',
                            cp1: [x1, y1],
                            cp2: [x2, y2],
                            p: [x, y]
                        });
                    }
                    lastCp2 = [x2, y2];
                    lastQuadCp = null;
                    curX = x;
                    curY = y;
                }
            } else if (cmdUpper === 'S') {
                while (hasMoreNums()) {
                    var sx2 = nextNum(), sy2 = nextNum();
                    var sx = nextNum(), sy = nextNum();
                    if (isRel) {
                        sx2 += curX; sy2 += curY;
                        sx += curX; sy += curY;
                    }
                    var sx1, sy1;
                    if (lastCp2) {
                        sx1 = 2 * curX - lastCp2[0];
                        sy1 = 2 * curY - lastCp2[1];
                    } else {
                        sx1 = curX;
                        sy1 = curY;
                    }
                    if (curSubpath) {
                        curSubpath.segments.push({
                            type: 'C',
                            cp1: [sx1, sy1],
                            cp2: [sx2, sy2],
                            p: [sx, sy]
                        });
                    }
                    lastCp2 = [sx2, sy2];
                    lastQuadCp = null;
                    curX = sx;
                    curY = sy;
                }
            } else if (cmdUpper === 'Q') {
                while (hasMoreNums()) {
                    var qx1 = nextNum(), qy1 = nextNum();
                    var qx = nextNum(), qy = nextNum();
                    if (isRel) {
                        qx1 += curX; qy1 += curY;
                        qx += curX; qy += curY;
                    }
                    // Quadratic to Cubic degree elevation
                    var qcp1x = curX + (2 / 3) * (qx1 - curX);
                    var qcp1y = curY + (2 / 3) * (qy1 - curY);
                    var qcp2x = qx + (2 / 3) * (qx1 - qx);
                    var qcp2y = qy + (2 / 3) * (qy1 - qy);

                    if (curSubpath) {
                        curSubpath.segments.push({
                            type: 'C',
                            cp1: [qcp1x, qcp1y],
                            cp2: [qcp2x, qcp2y],
                            p: [qx, qy]
                        });
                    }
                    lastQuadCp = [qx1, qy1];
                    lastCp2 = [qcp2x, qcp2y];
                    curX = qx;
                    curY = qy;
                }
            } else if (cmdUpper === 'T') {
                while (hasMoreNums()) {
                    var tx = nextNum(), ty = nextNum();
                    if (isRel) {
                        tx += curX; ty += curY;
                    }
                    var tqx1, tqy1;
                    if (lastQuadCp) {
                        tqx1 = 2 * curX - lastQuadCp[0];
                        tqy1 = 2 * curY - lastQuadCp[1];
                    } else {
                        tqx1 = curX;
                        tqy1 = curY;
                    }
                    var tcp1x = curX + (2 / 3) * (tqx1 - curX);
                    var tcp1y = curY + (2 / 3) * (tqy1 - curY);
                    var tcp2x = tx + (2 / 3) * (tqx1 - tx);
                    var tcp2y = ty + (2 / 3) * (tqy1 - ty);

                    if (curSubpath) {
                        curSubpath.segments.push({
                            type: 'C',
                            cp1: [tcp1x, tcp1y],
                            cp2: [tcp2x, tcp2y],
                            p: [tx, ty]
                        });
                    }
                    lastQuadCp = [tqx1, tqy1];
                    lastCp2 = [tcp2x, tcp2y];
                    curX = tx;
                    curY = ty;
                }
            } else if (cmdUpper === 'A') {
                while (hasMoreNums()) {
                    var arx = nextNum(), ary = nextNum();
                    var arot = nextNum();
                    var alarge = nextNum() !== 0;
                    var asweep = nextNum() !== 0;
                    var ax = nextNum(), ay = nextNum();
                    if (isRel) {
                        ax += curX;
                        ay += curY;
                    }
                    var arcSegs = arcToBeziers(curX, curY, arx, ary, arot, alarge, asweep, ax, ay);
                    if (curSubpath) {
                        for (var aIdx = 0; aIdx < arcSegs.length; aIdx++) {
                            curSubpath.segments.push(arcSegs[aIdx]);
                        }
                    }
                    lastCp2 = arcSegs.length > 0 && arcSegs[arcSegs.length - 1].cp2 ? arcSegs[arcSegs.length - 1].cp2 : null;
                    lastQuadCp = null;
                    curX = ax;
                    curY = ay;
                }
            } else if (cmdUpper === 'Z') {
                if (curSubpath) {
                    curSubpath.closed = true;
                    // If endpoint differs from start point, close it
                    if (Math.abs(curX - startX) > 0.0001 || Math.abs(curY - startY) > 0.0001) {
                        curSubpath.segments.push({
                            type: 'L',
                            p: [startX, startY]
                        });
                    }
                }
                curX = startX;
                curY = startY;
                lastCp2 = null;
                lastQuadCp = null;
            }
        }

        return subpaths;
    }

    /**
     * Converts normalized subpaths to After Effects Shape() arrays:
     * vertices, relative inTangents, relative outTangents, closed
     */
    function subpathToAeShape(subpath, transformFn) {
        var tf = transformFn || function (pt) { return pt; };
        var rawVerts = [];
        var rawInTangents = [];
        var rawOutTangents = [];

        var p0 = tf([subpath.startX, subpath.startY]);
        rawVerts.push(p0);
        rawInTangents.push([0, 0]);
        rawOutTangents.push([0, 0]);

        for (var s = 0; s < subpath.segments.length; s++) {
            var seg = subpath.segments[s];
            var lastIdx = rawVerts.length - 1;

            if (seg.type === 'L') {
                var p = tf(seg.p);
                // Check if closing segment duplicate
                if (s === subpath.segments.length - 1 && subpath.closed &&
                    Math.abs(p[0] - rawVerts[0][0]) < 0.001 && Math.abs(p[1] - rawVerts[0][1]) < 0.001) {
                    // Closed back to start
                    continue;
                }
                rawVerts.push(p);
                rawInTangents.push([0, 0]);
                rawOutTangents.push([0, 0]);
            } else if (seg.type === 'C') {
                var cp1 = tf(seg.cp1);
                var cp2 = tf(seg.cp2);
                var endP = tf(seg.p);

                // Check if closing segment duplicate
                var isCloseLoop = (s === subpath.segments.length - 1 && subpath.closed &&
                    Math.abs(endP[0] - rawVerts[0][0]) < 0.001 && Math.abs(endP[1] - rawVerts[0][1]) < 0.001);

                // Set outTangent for previous vertex (relative delta)
                var prevV = rawVerts[lastIdx];
                rawOutTangents[lastIdx] = [cp1[0] - prevV[0], cp1[1] - prevV[1]];

                if (isCloseLoop) {
                    // Set inTangent for the first vertex
                    rawInTangents[0] = [cp2[0] - rawVerts[0][0], cp2[1] - rawVerts[0][1]];
                } else {
                    rawVerts.push(endP);
                    rawInTangents.push([cp2[0] - endP[0], cp2[1] - endP[1]]);
                    rawOutTangents.push([0, 0]);
                }
            }
        }

        // Clean up small floating point numbers
        var vertices = [];
        var inTangents = [];
        var outTangents = [];

        for (var v = 0; v < rawVerts.length; v++) {
            vertices.push([round2(rawVerts[v][0]), round2(rawVerts[v][1])]);
            inTangents.push([round2(rawInTangents[v][0]), round2(rawInTangents[v][1])]);
            outTangents.push([round2(rawOutTangents[v][0]), round2(rawOutTangents[v][1])]);
        }

        return {
            vertices: vertices,
            inTangents: inTangents,
            outTangents: outTangents,
            closed: !!subpath.closed
        };
    }

    /**
     * Converts basic SVG shapes (<rect>, <circle>, <ellipse>, <line>, <polyline>, <polygon>) to path data d
     */
    function primitiveToPathData(elem) {
        var tag = elem.tagName.toLowerCase();
        var num = function (attr, def) {
            var v = elem.getAttribute(attr);
            return v !== null ? parseFloat(v) : (def || 0);
        };

        if (tag === 'rect') {
            var x = num('x', 0), y = num('y', 0);
            var w = num('width', 0), h = num('height', 0);
            var rx = num('rx', 0), ry = num('ry', 0);
            if (rx > 0 && ry === 0) ry = rx;
            if (ry > 0 && rx === 0) rx = ry;
            rx = Math.min(rx, w / 2);
            ry = Math.min(ry, h / 2);

            if (rx === 0 && ry === 0) {
                return 'M ' + x + ' ' + y + ' H ' + (x + w) + ' V' + (y + h) + ' H ' + x + ' Z';
            } else {
                // Rounded rect with cubic beziers
                var kx = rx * KAPPA;
                var ky = ry * KAPPA;
                return 'M ' + (x + rx) + ' ' + y +
                    ' H ' + (x + w - rx) +
                    ' C ' + (x + w - rx + kx) + ' ' + y + ' ' + (x + w) + ' ' + (y + ry - ky) + ' ' + (x + w) + ' ' + (y + ry) +
                    ' V ' + (y + h - ry) +
                    ' C ' + (x + w) + ' ' + (y + h - ry + ky) + ' ' + (x + w - rx + kx) + ' ' + (y + h) + ' ' + (x + w - rx) + ' ' + (y + h) +
                    ' H ' + (x + rx) +
                    ' C ' + (x + rx - kx) + ' ' + (y + h) + ' ' + x + ' ' + (y + h - ry + ky) + ' ' + x + ' ' + (y + h - ry) +
                    ' V ' + (y + ry) +
                    ' C ' + x + ' ' + (y + ry - ky) + ' ' + (x + rx - kx) + ' ' + y + ' ' + (x + rx) + ' ' + y + ' Z';
            }
        } else if (tag === 'circle') {
            var cx = num('cx', 0), cy = num('cy', 0), r = num('r', 0);
            var k = r * KAPPA;
            return 'M ' + cx + ' ' + (cy - r) +
                ' C ' + (cx + k) + ' ' + (cy - r) + ' ' + (cx + r) + ' ' + (cy - k) + ' ' + (cx + r) + ' ' + cy +
                ' C ' + (cx + r) + ' ' + (cy + k) + ' ' + (cx + k) + ' ' + (cy + r) + ' ' + cx + ' ' + (cy + r) +
                ' C ' + (cx - k) + ' ' + (cy + r) + ' ' + (cx - r) + ' ' + (cy + k) + ' ' + (cx - r) + ' ' + cy +
                ' C ' + (cx - r) + ' ' + (cy - k) + ' ' + (cx - k) + ' ' + (cy - r) + ' ' + cx + ' ' + (cy - r) + ' Z';
        } else if (tag === 'ellipse') {
            var ecx = num('cx', 0), ecy = num('cy', 0);
            var erx = num('rx', 0), ery = num('ry', 0);
            var ekx = erx * KAPPA;
            var eky = ery * KAPPA;
            return 'M ' + ecx + ' ' + (ecy - ery) +
                ' C ' + (ecx + ekx) + ' ' + (ecy - ery) + ' ' + (ecx + erx) + ' ' + (ecy - eky) + ' ' + (ecx + erx) + ' ' + ecy +
                ' C ' + (ecx + erx) + ' ' + (ecy + eky) + ' ' + (ecx + ekx) + ' ' + (ecy + ery) + ' ' + ecx + ' ' + (ecy + ery) +
                ' C ' + (ecx - ekx) + ' ' + (ecy + ery) + ' ' + (ecx - erx) + ' ' + (ecy + eky) + ' ' + (ecx - erx) + ' ' + ecy +
                ' C ' + (ecx - erx) + ' ' + (ecy - eky) + ' ' + (ecx - ekx) + ' ' + (ecy - ery) + ' ' + ecx + ' ' + (ecy - ery) + ' Z';
        } else if (tag === 'line') {
            return 'M ' + num('x1', 0) + ' ' + num('y1', 0) + ' L ' + num('x2', 0) + ' ' + num('y2', 0);
        } else if (tag === 'polyline' || tag === 'polygon') {
            var ptsStr = elem.getAttribute('points') || '';
            var pts = ptsStr.trim().split(/[\s,]+/);
            if (pts.length < 2) return '';
            var dStr = 'M ' + pts[0] + ' ' + pts[1];
            for (var p = 2; p < pts.length; p += 2) {
                if (pts[p] !== undefined && pts[p + 1] !== undefined) {
                    dStr += ' L ' + pts[p] + ' ' + pts[p + 1];
                }
            }
            if (tag === 'polygon') dStr += ' Z';
            return dStr;
        } else if (tag === 'path') {
            return elem.getAttribute('d') || '';
        }
        return '';
    }

    /**
     * Parses SVG transform attribute: translate, scale, rotate, matrix, skewX, skewY
     */
    function parseTransform(transformStr) {
        if (!transformStr) return [1, 0, 0, 1, 0, 0];
        var matrix = [1, 0, 0, 1, 0, 0]; // [a, b, c, d, e, f]

        var multiply = function (m1, m2) {
            return [
                m1[0] * m2[0] + m1[2] * m2[1],
                m1[1] * m2[0] + m1[3] * m2[1],
                m1[0] * m2[2] + m1[2] * m2[3],
                m1[1] * m2[2] + m1[3] * m2[3],
                m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
                m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
            ];
        };

        var regex = /([a-zA-Z]+)\s*\(([^)]+)\)/g;
        var match;
        while ((match = regex.exec(transformStr)) !== null) {
            var type = match[1].toLowerCase();
            var args = match[2].trim().split(/[\s,]+/).map(parseFloat);

            if (type === 'matrix' && args.length >= 6) {
                matrix = multiply(matrix, args);
            } else if (type === 'translate') {
                var tx = args[0] || 0;
                var ty = args[1] !== undefined ? args[1] : 0;
                matrix = multiply(matrix, [1, 0, 0, 1, tx, ty]);
            } else if (type === 'scale') {
                var sx = args[0] !== undefined ? args[0] : 1;
                var sy = args[1] !== undefined ? args[1] : sx;
                matrix = multiply(matrix, [sx, 0, 0, sy, 0, 0]);
            } else if (type === 'rotate') {
                var deg = args[0] || 0;
                var rad = (deg * Math.PI) / 180;
                var cos = Math.cos(rad);
                var sin = Math.sin(rad);
                if (args.length >= 3) {
                    var cx = args[1];
                    var cy = args[2];
                    matrix = multiply(matrix, [1, 0, 0, 1, cx, cy]);
                    matrix = multiply(matrix, [cos, sin, -sin, cos, 0, 0]);
                    matrix = multiply(matrix, [1, 0, 0, 1, -cx, -cy]);
                } else {
                    matrix = multiply(matrix, [cos, sin, -sin, cos, 0, 0]);
                }
            } else if (type === 'skewx') {
                var radX = ((args[0] || 0) * Math.PI) / 180;
                matrix = multiply(matrix, [1, 0, Math.tan(radX), 1, 0, 0]);
            } else if (type === 'skewy') {
                var radY = ((args[0] || 0) * Math.PI) / 180;
                matrix = multiply(matrix, [1, Math.tan(radY), 0, 1, 0, 0]);
            }
        }

        return matrix;
    }

    function applyMatrix(matrix, pt) {
        return [
            matrix[0] * pt[0] + matrix[2] * pt[1] + matrix[4],
            matrix[1] * pt[0] + matrix[3] * pt[1] + matrix[5]
        ];
    }

    /**
     * Extracts styles from element attributes or inline style property
     */
    function extractElementStyles(elem, parentStyles) {
        var styles = Object.assign({}, parentStyles || {});

        var getAttrOrStyle = function (name) {
            if (elem.hasAttribute(name)) return elem.getAttribute(name);
            var styleAttr = elem.getAttribute('style');
            if (styleAttr) {
                var regex = new RegExp('(?:^|;)\\s*' + name + '\\s*:\\s*([^;]+)', 'i');
                var match = styleAttr.match(regex);
                if (match) return match[1].trim();
            }
            return null;
        };

        // Fill
        var fillVal = getAttrOrStyle('fill');
        if (fillVal !== null) {
            styles.fill = parseColor(fillVal);
        } else if (!parentStyles || !parentStyles.fill) {
            styles.fill = { rgb: [0, 0, 0], opacity: 100 }; // Default black fill in SVG
        }

        // Fill Opacity
        var fillOpVal = getAttrOrStyle('fill-opacity');
        if (fillOpVal !== null) {
            styles.fillOpacity = parseFloat(fillOpVal) * 100;
        }

        // Stroke
        var strokeVal = getAttrOrStyle('stroke');
        if (strokeVal !== null) {
            styles.stroke = parseColor(strokeVal);
        }

        // Stroke Width
        var strokeWidthVal = getAttrOrStyle('stroke-width');
        if (strokeWidthVal !== null) {
            styles.strokeWidth = parseFloat(strokeWidthVal);
        }

        // Stroke Opacity
        var strokeOpVal = getAttrOrStyle('stroke-opacity');
        if (strokeOpVal !== null) {
            styles.strokeOpacity = parseFloat(strokeOpVal) * 100;
        }

        // Line Cap (butt=1, round=2, projecting=3)
        var capVal = getAttrOrStyle('stroke-linecap');
        if (capVal) {
            capVal = capVal.toLowerCase();
            if (capVal === 'round') styles.lineCap = 2;
            else if (capVal === 'square') styles.lineCap = 3;
            else styles.lineCap = 1;
        }

        // Line Join (miter=1, round=2, bevel=3)
        var joinVal = getAttrOrStyle('stroke-linejoin');
        if (joinVal) {
            joinVal = joinVal.toLowerCase();
            if (joinVal === 'round') styles.lineJoin = 2;
            else if (joinVal === 'bevel') styles.lineJoin = 3;
            else styles.lineJoin = 1;
        }

        // Miter Limit
        var miterVal = getAttrOrStyle('stroke-miterlimit');
        if (miterVal !== null) {
            styles.miterLimit = parseFloat(miterVal);
        }

        // Dash Array
        var dashVal = getAttrOrStyle('stroke-dasharray');
        if (dashVal && dashVal !== 'none') {
            styles.dashArray = dashVal.trim().split(/[\s,]+/).map(parseFloat);
        }

        // Overall Opacity
        var opVal = getAttrOrStyle('opacity');
        if (opVal !== null) {
            var elemOp = parseFloat(opVal) * 100;
            styles.opacity = (styles.opacity !== undefined ? (styles.opacity * elemOp / 100) : elemOp);
        }

        // Fill Rule (nonzero=1, evenodd=2)
        var ruleVal = getAttrOrStyle('fill-rule');
        if (ruleVal) {
            styles.fillRule = ruleVal.toLowerCase() === 'evenodd' ? 2 : 1;
        }

        return styles;
    }

    /**
     * Parses <linearGradient> and <radialGradient> definitions in <defs>
     */
    function parseGradients(svgDoc) {
        var gradients = {};
        if (!svgDoc) return gradients;

        var linearElems = svgDoc.querySelectorAll('linearGradient');
        for (var i = 0; i < linearElems.length; i++) {
            var lg = linearElems[i];
            var id = lg.getAttribute('id');
            if (!id) continue;

            var stops = [];
            var stopElems = lg.querySelectorAll('stop');
            for (var s = 0; s < stopElems.length; s++) {
                var st = stopElems[s];
                var offsetStr = st.getAttribute('offset') || '0';
                var offset = offsetStr.indexOf('%') !== -1 ? parseFloat(offsetStr) / 100 : parseFloat(offsetStr);
                var stopColor = st.getAttribute('stop-color') || '#000000';
                var stopOpacity = st.getAttribute('stop-opacity');
                var parsedC = parseColor(stopColor);
                stops.push({
                    offset: Math.max(0, Math.min(1, offset)),
                    rgb: parsedC && parsedC.rgb ? parsedC.rgb : [0, 0, 0],
                    opacity: stopOpacity !== null ? parseFloat(stopOpacity) * 100 : (parsedC ? parsedC.opacity : 100)
                });
            }

            gradients[id] = {
                type: 'linear',
                x1: lg.getAttribute('x1') || '0%',
                y1: lg.getAttribute('y1') || '0%',
                x2: lg.getAttribute('x2') || '100%',
                y2: lg.getAttribute('y2') || '0%',
                stops: stops
            };
        }

        var radialElems = svgDoc.querySelectorAll('radialGradient');
        for (var r = 0; r < radialElems.length; r++) {
            var rg = radialElems[r];
            var rId = rg.getAttribute('id');
            if (!rId) continue;

            var rStops = [];
            var rStopElems = rg.querySelectorAll('stop');
            for (var rs = 0; rs < rStopElems.length; rs++) {
                var rst = rStopElems[rs];
                var rOffsetStr = rst.getAttribute('offset') || '0';
                var rOffset = rOffsetStr.indexOf('%') !== -1 ? parseFloat(rOffsetStr) / 100 : parseFloat(rOffsetStr);
                var rStopColor = rst.getAttribute('stop-color') || '#000000';
                var rStopOpacity = rst.getAttribute('stop-opacity');
                var rParsedC = parseColor(rStopColor);
                rStops.push({
                    offset: Math.max(0, Math.min(1, rOffset)),
                    rgb: rParsedC && rParsedC.rgb ? rParsedC.rgb : [0, 0, 0],
                    opacity: rStopOpacity !== null ? parseFloat(rStopOpacity) * 100 : (rParsedC ? rParsedC.opacity : 100)
                });
            }

            gradients[rId] = {
                type: 'radial',
                cx: rg.getAttribute('cx') || '50%',
                cy: rg.getAttribute('cy') || '50%',
                r: rg.getAttribute('r') || '50%',
                stops: rStops
            };
        }

        return gradients;
    }

    /**
     * Lightweight DOM fallback parser for Node.js or test environments without DOMParser
     */
    function parseSvgFallback(xmlStr) {
        var cleanStr = xmlStr.replace(/<!--[\s\S]*?-->/g, '').trim();

        function createNode(tagName, attrs) {
            return {
                tagName: tagName.toLowerCase(),
                attributes: attrs || {},
                children: [],
                getAttribute: function (name) {
                    var val = this.attributes[name] !== undefined ? this.attributes[name] : (this.attributes[name.toLowerCase()]);
                    return val !== undefined ? String(val) : null;
                },
                hasAttribute: function (name) {
                    return this.attributes[name] !== undefined || this.attributes[name.toLowerCase()] !== undefined;
                },
                querySelector: function (sel) {
                    var target = sel.toLowerCase();
                    if (this.tagName === target) return this;
                    for (var c = 0; c < this.children.length; c++) {
                        var res = this.children[c].querySelector(target);
                        if (res) return res;
                    }
                    return null;
                },
                querySelectorAll: function (sel) {
                    var target = sel.toLowerCase();
                    var list = [];
                    if (this.tagName === target) list.push(this);
                    for (var c = 0; c < this.children.length; c++) {
                        var sub = this.children[c].querySelectorAll(target);
                        for (var s = 0; s < sub.length; s++) list.push(sub[s]);
                    }
                    return list;
                }
            };
        }

        var tagRegex = /<\/?([a-zA-Z0-9:-]+)((?:\s+[a-zA-Z0-9:_-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
        var attrRegex = /([a-zA-Z0-9:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;

        var root = {
            tagName: '#document',
            children: [],
            querySelector: function (sel) {
                for (var i = 0; i < this.children.length; i++) {
                    var res = this.children[i].querySelector(sel);
                    if (res) return res;
                }
                return null;
            },
            querySelectorAll: function (sel) {
                var list = [];
                for (var i = 0; i < this.children.length; i++) {
                    var sub = this.children[i].querySelectorAll(sel);
                    for (var s = 0; s < sub.length; s++) list.push(sub[s]);
                }
                return list;
            }
        };

        var stack = [root];
        var match;

        while ((match = tagRegex.exec(cleanStr)) !== null) {
            var isClosing = match[0].charAt(1) === '/';
            var tagName = match[1];
            var attrString = match[2];
            var isSelfClosing = match[3] === '/' || tagName.toLowerCase() === 'path' || tagName.toLowerCase() === 'rect' ||
                tagName.toLowerCase() === 'circle' || tagName.toLowerCase() === 'ellipse' ||
                tagName.toLowerCase() === 'line' || tagName.toLowerCase() === 'polyline' ||
                tagName.toLowerCase() === 'polygon' || tagName.toLowerCase() === 'stop';

            if (isClosing) {
                if (stack.length > 1) {
                    stack.pop();
                }
            } else {
                var attrs = {};
                var aMatch;
                while ((aMatch = attrRegex.exec(attrString)) !== null) {
                    var aName = aMatch[1];
                    var aVal = aMatch[2] !== undefined ? aMatch[2] : (aMatch[3] !== undefined ? aMatch[3] : aMatch[4]);
                    attrs[aName] = aVal;
                    attrs[aName.toLowerCase()] = aVal;
                }

                var node = createNode(tagName, attrs);
                var parent = stack[stack.length - 1];
                parent.children.push(node);

                if (!isSelfClosing && match[0].indexOf('/>') === -1) {
                    stack.push(node);
                }
            }
        }

        return root;
    }

    /**
     * Main Transpilation Function: Converts SVG string into Shape Layer Intermediate Representation (IR)
     * @param {string} svgString Full SVG XML content
     * @param {Object} options Configuration options:
     *   - compWidth: number (default: 1920)
     *   - compHeight: number (default: 1080)
     *   - position: [x, y] comp coordinates (default: comp center)
     *   - scale: [sx, sy] percentage (default: [100, 100])
     *   - mode: "single_layer" | "separate_layers" (default: "single_layer")
     *   - layerName: string (optional target shape layer name)
     */
    function transpile(svgString, options) {
        var opts = options || {};
        var compW = opts.compWidth || 1920;
        var compH = opts.compHeight || 1080;
        var mode = opts.mode || 'single_layer';

        // Parse XML DOM
        var doc;
        if (typeof DOMParser !== 'undefined') {
            var parser = new DOMParser();
            doc = parser.parseFromString(svgString, 'image/svg+xml');
            var parserError = doc.querySelector('parsererror');
            if (parserError) {
                throw new Error('SVG Parsing Error: ' + parserError.textContent);
            }
        } else {
            // Built-in lightweight fallback parser for Node.js / headless environments
            doc = parseSvgFallback(svgString);
        }

        var svgElem = doc.querySelector ? doc.querySelector('svg') : (doc.tagName === 'svg' ? doc : null);
        if (!svgElem) {
            throw new Error('No <svg> root element found in provided input.');
        }

        // ViewBox & Canvas dimensions
        var viewBoxAttr = svgElem.getAttribute('viewBox');
        var svgW = parseFloat(svgElem.getAttribute('width')) || compW;
        var svgH = parseFloat(svgElem.getAttribute('height')) || compH;
        var minX = 0, minY = 0, vbW = svgW, vbH = svgH;

        if (viewBoxAttr) {
            var vbParts = viewBoxAttr.trim().split(/[\s,]+/).map(parseFloat);
            if (vbParts.length >= 4) {
                minX = vbParts[0];
                minY = vbParts[1];
                vbW = vbParts[2];
                vbH = vbParts[3];
            }
        }

        // Check if viewBox matches comp dimensions 1:1
        var isCompSized = (Math.abs(vbW - compW) < 1 && Math.abs(vbH - compH) < 1 && minX === 0 && minY === 0);

        // Center offset calculation:
        // In AE, shape layer contents are positioned relative to the layer anchor point [0, 0]
        var offsetX = minX + vbW / 2;
        var offsetY = minY + vbH / 2;

        var defaultPos = isCompSized ? [compW / 2, compH / 2] : (opts.position || [compW / 2, compH / 2]);
        var defaultScale = opts.scale || [100, 100];

        // Coordinate transformation function
        var transformCoord = function (pt, matrix) {
            var p = pt;
            if (matrix) p = applyMatrix(matrix, p);
            // Translate relative to SVG center so [0,0] is at shape anchor point
            return [
                p[0] - offsetX,
                p[1] - offsetY
            ];
        };

        var gradients = parseGradients(doc);
        var layers = [];

        // Traversal function for elements
        var processElement = function (elem, parentMatrix, parentStyles, groupList) {
            var tag = elem.tagName.toLowerCase();
            if (tag === 'defs' || tag === 'style' || tag === 'script' || tag === 'title' || tag === 'desc') return;

            var localMatrix = parseTransform(elem.getAttribute('transform'));
            var curMatrix = parentMatrix ? [
                parentMatrix[0] * localMatrix[0] + parentMatrix[2] * localMatrix[1],
                parentMatrix[1] * localMatrix[0] + parentMatrix[3] * localMatrix[1],
                parentMatrix[0] * localMatrix[2] + parentMatrix[2] * localMatrix[3],
                parentMatrix[1] * localMatrix[2] + parentMatrix[3] * localMatrix[3],
                parentMatrix[0] * localMatrix[4] + parentMatrix[2] * localMatrix[5] + parentMatrix[4],
                parentMatrix[1] * localMatrix[4] + parentMatrix[3] * localMatrix[5] + parentMatrix[5]
            ] : localMatrix;

            var styles = extractElementStyles(elem, parentStyles);
            var elemId = elem.getAttribute('id') || elem.getAttribute('class') || '';

            if (tag === 'g') {
                var childNodes = elem.children;
                var gGroup = {
                    name: elemId || 'Group',
                    isContainer: true,
                    shapes: []
                };

                for (var c = 0; c < childNodes.length; c++) {
                    processElement(childNodes[c], curMatrix, styles, gGroup.shapes);
                }

                if (gGroup.shapes.length > 0) {
                    groupList.push(gGroup);
                }
                return;
            }

            var pathD = primitiveToPathData(elem);
            if (!pathD) return;

            var subpaths = parsePathData(pathD);
            if (subpaths.length === 0) return;

            var shapePaths = [];
            for (var sp = 0; sp < subpaths.length; sp++) {
                var aeShape = subpathToAeShape(subpaths[sp], function (pt) {
                    return transformCoord(pt, curMatrix);
                });
                if (aeShape.vertices.length > 0) {
                    shapePaths.push(aeShape);
                }
            }

            if (shapePaths.length === 0) return;

            // Resolve gradient if fill uses url(#id)
            var fillData = styles.fill;
            var gradientData = null;
            if (fillData && fillData.gradientId && gradients[fillData.gradientId]) {
                gradientData = gradients[fillData.gradientId];
            }

            var groupName = elemId || (tag.charAt(0).toUpperCase() + tag.slice(1));
            var shapeItem = {
                name: groupName,
                paths: shapePaths,
                styles: {
                    fill: fillData && !fillData.none ? {
                        rgb: fillData.rgb || [0.8, 0.8, 0.8],
                        opacity: styles.fillOpacity !== undefined ? styles.fillOpacity : (fillData.opacity !== undefined ? fillData.opacity : 100),
                        rule: styles.fillRule || 1,
                        gradient: gradientData
                    } : null,
                    stroke: styles.stroke && !styles.stroke.none ? {
                        rgb: styles.stroke.rgb || [0, 0, 0],
                        width: styles.strokeWidth !== undefined ? styles.strokeWidth : 1,
                        opacity: styles.strokeOpacity !== undefined ? styles.strokeOpacity : (styles.stroke.opacity !== undefined ? styles.stroke.opacity : 100),
                        lineCap: styles.lineCap || 1,
                        lineJoin: styles.lineJoin || 1,
                        miterLimit: styles.miterLimit || 4,
                        dashArray: styles.dashArray || null
                    } : null,
                    opacity: styles.opacity !== undefined ? styles.opacity : 100
                }
            };

            groupList.push(shapeItem);
        };

        if (mode === 'separate_layers') {
            // Each top-level <g id="..."> or shape element becomes its own layer
            var topChildren = svgElem.children;
            for (var t = 0; t < topChildren.length; t++) {
                var topElem = topChildren[t];
                var topTag = topElem.tagName.toLowerCase();
                if (topTag === 'defs' || topTag === 'style' || topTag === 'script' || topTag === 'title' || topTag === 'desc') continue;

                var topId = topElem.getAttribute('id') || topElem.getAttribute('class') || ('Layer ' + (t + 1));
                var layerGroups = [];
                processElement(topElem, null, {}, layerGroups);

                if (layerGroups.length > 0) {
                    layers.push({
                        layerName: topId,
                        position: defaultPos,
                        scale: defaultScale,
                        groups: layerGroups
                    });
                }
            }
        } else {
            // Single Shape Layer mode (Default)
            var allGroups = [];
            var children = svgElem.children;
            for (var i = 0; i < children.length; i++) {
                processElement(children[i], null, {}, allGroups);
            }

            var rootLayerName = opts.layerName || svgElem.getAttribute('id') || 'SVG Vector Layer';
            layers.push({
                layerName: rootLayerName,
                position: defaultPos,
                scale: defaultScale,
                groups: allGroups
            });
        }

        return {
            mode: mode,
            viewBox: [minX, minY, vbW, vbH],
            compDimensions: [compW, compH],
            layers: layers
        };
    }

    /**
     * Transpiles SVG into human-readable ExtendScript JSX code block
     */
    function toExtendScript(svgString, options) {
        var ir = transpile(svgString, options);
        var lines = [];

        lines.push('// Generated by ArcEditor SVG Transpiler');
        lines.push('var comp = app.project.activeItem;');
        lines.push('if (!comp || !(comp instanceof CompItem)) throw new Error("No active composition found.");');
        lines.push('');

        for (var l = 0; l < ir.layers.length; l++) {
            var lay = ir.layers[l];
            var lVar = 'shapeLayer_' + (l + 1);
            lines.push('// --- Layer: ' + lay.layerName + ' ---');
            lines.push('var ' + lVar + ' = comp.layers.addShape();');
            lines.push(lVar + '.name = ' + JSON.stringify(lay.layerName) + ';');
            lines.push(lVar + '.property("Position").setValue([' + lay.position[0] + ', ' + lay.position[1] + ']);');
            if (lay.scale[0] !== 100 || lay.scale[1] !== 100) {
                lines.push(lVar + '.property("Scale").setValue([' + lay.scale[0] + ', ' + lay.scale[1] + ']);');
            }
            lines.push('var ' + lVar + '_contents = ' + lVar + '.property("Contents");');
            lines.push('');

            var emitGroup = function (grp, parentVar, pfx) {
                if (grp.isContainer && grp.shapes) {
                    var containerVar = pfx + '_g';
                    lines.push('// Group: ' + grp.name);
                    lines.push('var ' + containerVar + ' = ' + parentVar + '.addProperty("ADBE Vector Group");');
                    lines.push(containerVar + '.name = ' + JSON.stringify(grp.name) + ';');
                    lines.push('var ' + containerVar + '_contents = ' + containerVar + '.property("Contents");');
                    // Reverse iteration for AE stacking order
                    for (var g = grp.shapes.length - 1; g >= 0; g--) {
                        emitGroup(grp.shapes[g], containerVar + '_contents', pfx + '_' + g);
                    }
                    return;
                }

                var grpVar = pfx + '_item';
                lines.push('// Shape Group: ' + grp.name);
                lines.push('var ' + grpVar + ' = ' + parentVar + '.addProperty("ADBE Vector Group");');
                lines.push(grpVar + '.name = ' + JSON.stringify(grp.name) + ';');
                lines.push('var ' + grpVar + '_contents = ' + grpVar + '.property("Contents");');

                // Add Path(s)
                for (var p = 0; p < grp.paths.length; p++) {
                    var pObj = grp.paths[p];
                    var pVar = grpVar + '_path_' + (p + 1);
                    var sVar = grpVar + '_shape_' + (p + 1);
                    lines.push('var ' + pVar + ' = ' + grpVar + '_contents.addProperty("ADBE Vector Shape - Group");');
                    lines.push('var ' + sVar + ' = new Shape();');
                    lines.push(sVar + '.vertices = ' + JSON.stringify(pObj.vertices) + ';');
                    lines.push(sVar + '.inTangents = ' + JSON.stringify(pObj.inTangents) + ';');
                    lines.push(sVar + '.outTangents = ' + JSON.stringify(pObj.outTangents) + ';');
                    lines.push(sVar + '.closed = ' + (pObj.closed ? 'true' : 'false') + ';');
                    lines.push(pVar + '.property("Path").setValue(' + sVar + ');');
                }

                // Add Fill
                if (grp.styles.fill) {
                    var fVar = grpVar + '_fill';
                    lines.push('var ' + fVar + ' = ' + grpVar + '_contents.addProperty("ADBE Vector Graphic - Fill");');
                    lines.push(fVar + '.property("Color").setValue(' + JSON.stringify(grp.styles.fill.rgb) + ');');
                    if (grp.styles.fill.opacity !== 100) {
                        lines.push(fVar + '.property("Opacity").setValue(' + grp.styles.fill.opacity + ');');
                    }
                    if (grp.styles.fill.rule === 2) {
                        lines.push(fVar + '.property("ADBE Vector Fill Rule").setValue(2); // Even-Odd');
                    }
                }

                // Add Stroke
                if (grp.styles.stroke) {
                    var stVar = grpVar + '_stroke';
                    lines.push('var ' + stVar + ' = ' + grpVar + '_contents.addProperty("ADBE Vector Graphic - Stroke");');
                    lines.push(stVar + '.property("Color").setValue(' + JSON.stringify(grp.styles.stroke.rgb) + ');');
                    lines.push(stVar + '.property("Stroke Width").setValue(' + grp.styles.stroke.width + ');');
                    if (grp.styles.stroke.opacity !== 100) {
                        lines.push(stVar + '.property("Opacity").setValue(' + grp.styles.stroke.opacity + ');');
                    }
                    if (grp.styles.stroke.lineCap !== 1) {
                        lines.push(stVar + '.property("Line Cap").setValue(' + grp.styles.stroke.lineCap + ');');
                    }
                    if (grp.styles.stroke.lineJoin !== 1) {
                        lines.push(stVar + '.property("Line Join").setValue(' + grp.styles.stroke.lineJoin + ');');
                    }
                }

                // Opacity
                if (grp.styles.opacity !== 100) {
                    lines.push('var ' + grpVar + '_tf = ' + grpVar + '.property("Transform");');
                    lines.push(grpVar + '_tf.property("Opacity").setValue(' + grp.styles.opacity + ');');
                }
                lines.push('');
            };

            // Reverse iteration for AE stacking order
            for (var gr = lay.groups.length - 1; gr >= 0; gr--) {
                emitGroup(lay.groups[gr], lVar + '_contents', lVar + '_g' + gr);
            }
        }

        return lines.join('\n');
    }

    return {
        transpile: transpile,
        toExtendScript: toExtendScript,
        parsePathData: parsePathData,
        subpathToAeShape: subpathToAeShape,
        arcToBeziers: arcToBeziers,
        parseColor: parseColor,
        primitiveToPathData: primitiveToPathData
    };
}));
