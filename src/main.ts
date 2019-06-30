/**
 * Math for making bezier curves out of lines.
 *
 * Implements a modified version of the algorithm defined:
 * Efficient Curve Fitting by Sarah Frisken
 * Journal of Graphics Tools, 13(2), pp. 37-37, 2008
 * https://pdfs.semanticscholar.org/9f5d/fa77f61a4dc87faa243f995e2092ddb3f521.pdf
 *
 */

export function startCurve(coord) {
    curve = createCurve(roundVec(coord));
}

export function addToCurve(coord): any {
    const rounded_coord = roundVec(coord);
    const segment = addToCurveImpl(curve, rounded_coord);
    if (segment.update_status == UpdateStatus.SUCCESS) {
        return segment;
    }
    return addToCurveImpl(curve, rounded_coord);
}

let curve;

const MAX_ERROR = 2;
const FIELD_RADIUS = 9;
const NUM_SAMPLE_POINTS = 9;
const MAX_ITERATIONS = 50;
const MAX_CORNER_ANGLE = 80;
const RADIAL_SIMPLIFICATION = 1;
const SHOULD_USE_NEW_CORNER_FINDER = true;
const SHOULD_USE_MY_FORCE_VECTORS = true;

const UpdateStatus = {
    SUCCESS: 1,
    FAIL_CORNER: 2,
    FAIL_MAXED: 3,
};

const initCurve = () => ({ segments: [] as any[], vdmap: [] });
const initCurveSegment = (x, y) => ({
    c0: { x, y },
    c1: { x, y },
    c2: { x, y },
    c3: { x, y },
});
const getLastSegment = (curve) => curve.segments[curve.segments.length - 1];
const getLastPoint = (segment) => segment.c3;
const copySegment = function(segment) {
    return {
        c0: { x: segment.c0.x, y: segment.c0.y },
        c1: { x: segment.c1.x, y: segment.c1.y },
        c2: { x: segment.c2.x, y: segment.c2.y },
        c3: { x: segment.c3.x, y: segment.c3.y },
        constrain_to:
            segment.constrain_to == undefined
                ? undefined
                : { x: segment.constrain_to.x, y: segment.constrain_to.y },
        error: segment.error || 0,
        update_status: segment.update_status,
    };
};

const createCurve = function({ x, y }) {
    const curve = initCurve();
    curve.segments.push(initCurveSegment(x, y));
    return curve;
};

const addToCurveImpl = function(curve, new_point) {
    const last_segment = getLastSegment(curve);
    const last_point = getLastPoint(last_segment);

    // We do too much work with too little benefit if points are too close together.
    if (getMagnitude(new_point, getLastPoint(last_segment)) < RADIAL_SIMPLIFICATION)
        return last_segment;

    if (
        UpdateStatus.SUCCESS != last_segment.update_status &&
        last_segment.update_status !== undefined
    ) {
        let new_segment;
        // Start a new, unconstrained segment for corners.
        if (UpdateStatus.FAIL_CORNER == last_segment.update_status) {
            new_segment = initCurveSegment(last_point.x, last_point.y);
            // We had to give up, so continue the curve, but with a new segment.
        } else if (UpdateStatus.FAIL_MAXED == last_segment.update_status) {
            new_segment = initCurveSegment(last_point.x, last_point.y);
            new_segment.constrain_to = getUnitVector(getCurveEndTangent(last_segment));
        }

        // Reset the vector distance map because we're fitting a new curve!
        curve.vdmap = [];
        curve.segments.push(new_segment);
    }

    return updateDistanceField(curve, new_point);
};

const updateDistanceField = function(curve, current_point) {
    const segment = getLastSegment(curve);
    const { x, y } = current_point;

    let last_point = getLastPoint(segment);
    const og_controls = copySegment(segment);

    if (checkCorner(segment, current_point)) {
        segment.update_status = UpdateStatus.FAIL_CORNER;
        return segment;
    }

    segment.c3 = { x, y };
    segment.c2 = {
        x: segment.c2.x + x - last_point.x,
        y: segment.c2.y + y - last_point.y,
    };

    //
    // Prep the rectangle around our line in which we'll store distance-to-the-line
    // for each pixel in the box.
    const perp_vec = getPerpindicularUnitVector(last_point, current_point);
    const dist = getScaledVectorDifference(perp_vec);
    const a1 = addVec(last_point, dist);
    const b1 = addVec(current_point, dist);

    const vert_diff = negateVec(multVec(dist, 2));
    const vert_steps = getDDASteps(vert_diff);
    const vert_increment = divVec(vert_diff, vert_steps);

    const horiz_diff = subVec(b1, a1);
    const horiz_steps = getDDASteps(horiz_diff);
    const horiz_increment = divVec(horiz_diff, horiz_steps);

    //
    // "Render" the rectangle around the line by interpolating `current_val`
    // up the box (perpindicularly to the line) for each step across the box
    // (parallel to the line). This is a very basic rasterization concept with a
    // scary name: Digital Differential Analyzer (DDA).
    //
    // a1------------------b1  -,
    // |                    |   |-> FIELD_RADIUS
    // |------the line------|  -'
    // |               •----|-------> Sample distance "pixel": { x: 0, y: -1 }
    // a2------------------b2
    let current_horiz_location = a1;
    for (let i = 0; i < horiz_steps; i++) {
        let current_location = current_horiz_location;
        let current_val = dist;
        for (let j = 0; j < vert_steps; j++) {
            const { x, y } = roundVec(current_location);
            if (!curve.vdmap[x]) curve.vdmap[x] = [];
            if (curve.vdmap[x][y] == undefined) {
                curve.vdmap[x][y] = roundVec(current_val);
            } else {
                curve.vdmap[x][y] =
                    sumOfSquaresVec(curve.vdmap[x][y]) < sumOfSquaresVec(roundVec(current_val))
                        ? curve.vdmap[x][y]
                        : roundVec(current_val);
            }

            current_val = addVec(current_val, vert_increment);
            current_location = addVec(current_location, vert_increment);
        }

        current_horiz_location = addVec(current_horiz_location, horiz_increment);
    }

    //
    // "Render" a square cap at the endpoint.
    const upperLeftPoint = subVec(current_point, { x: FIELD_RADIUS, y: FIELD_RADIUS });
    const bottomRightPoint = addVec(current_point, { x: FIELD_RADIUS, y: FIELD_RADIUS });
    for (let x = upperLeftPoint.x; x < bottomRightPoint.x; x++) {
        for (let y = upperLeftPoint.y; y < bottomRightPoint.y; y++) {
            if (!curve.vdmap[x]) curve.vdmap[x] = [];
            const val = subVec({ x, y }, current_point);
            if (curve.vdmap[x][y] == undefined) {
                curve.vdmap[x][y] = val;
            } else {
                curve.vdmap[x][y] =
                    sumOfSquaresVec(curve.vdmap[x][y]) < sumOfSquaresVec(val)
                        ? curve.vdmap[x][y]
                        : val;
            }
        }
    }

    //
    // Trial-and-error over and over to get a curve that fits nicely.
    let steps = 0;
    while (true) {
        let f1 = { x: 0, y: 0 };
        let f2 = { x: 0, y: 0 };

        //
        // Create force vectors by checking the distance (with the vector
        // distance field we've built up above so it's fast) of our
        // iteratively-fitting curve and pushing the control points
        // in the direction that helps most.
        for (let i = 0; i < NUM_SAMPLE_POINTS; i++) {
            const t = i / NUM_SAMPLE_POINTS;
            const point = roundVec(getPointAlongCurve(segment, t));
            const dist = getDistanceFromPolyline(curve, point);
            const d = magnitudeVec(dist);
            const dx = dist.x,
                dy = dist.y;
            let modifier = 1;
            if (SHOULD_USE_MY_FORCE_VECTORS) {
                if (t < 0.1 || t > 0.9) modifier = 10;
            }
            f1.x += t * Math.pow(1 - t, 2) * d * dx * modifier;
            f1.y += t * Math.pow(1 - t, 2) * d * dy * modifier;
            f2.x += Math.pow(t, 2) * (1 - t) * d * dx * modifier;
            f2.y += Math.pow(t, 2) * (1 - t) * d * dy * modifier;
        }

        //
        // Push the force vectors slightly toward the middle to mitigate
        // hooking at the end of the curve.
        if (SHOULD_USE_MY_FORCE_VECTORS) {
            const from_end = subVec(getSegmentMidpoint(segment), segment.c2);
            const from_beginning = subVec(getSegmentMidpoint(segment), segment.c1);
            f1 = subVec(f1, multVec(from_beginning, 0.03));
            f2 = subVec(f2, multVec(from_end, 0.03));
        }

        //
        // Constrain the first control point to adjust itself along the same
        // line as the previous segments second control point so the curve
        // looks continuous.
        if (segment.constrain_to) {
            f1 = multVec(segment.constrain_to, dotProduct(segment.constrain_to, f1));
        }

        //
        // Apply the force vectors to the control points.
        const alpha = 1;
        segment.c1.x -= (alpha * f1.x * 6) / NUM_SAMPLE_POINTS;
        segment.c1.y -= (alpha * f1.y * 6) / NUM_SAMPLE_POINTS;
        segment.c2.x -= (alpha * f2.x * 6) / NUM_SAMPLE_POINTS;
        segment.c2.y -= (alpha * f2.y * 6) / NUM_SAMPLE_POINTS;

        //
        // Add up the error of the curve (again with our fast distance field).
        let error = 0;
        for (let i = 0; i < NUM_SAMPLE_POINTS; i++) {
            const t = i / NUM_SAMPLE_POINTS;
            const point = getPointAlongCurve(segment, t);
            const dist = getDistanceFromPolyline(curve, roundVec(point));
            error += Math.pow(dist.x, 2) + Math.pow(dist.y, 2);
        }
        error = error / NUM_SAMPLE_POINTS;
        steps++;

        segment.error = error;
        segment.steps = steps;

        //
        // Do it all again unless the curve is good enough or we've been at it for a bit.
        if (error < MAX_ERROR || steps > MAX_ITERATIONS) break;
    }

    //
    // If we failed, reset the segment back to the way it was.
    if (steps > MAX_ITERATIONS) {
        segment.c0 = og_controls.c0;
        segment.c1 = og_controls.c1;
        segment.c2 = og_controls.c2;
        segment.c3 = og_controls.c3;
        segment.error = og_controls.error;
        segment.constrain_to = og_controls.constrain_to;
        segment.update_status = UpdateStatus.FAIL_MAXED;
        return segment;
    }

    segment.update_status = UpdateStatus.SUCCESS;
    return segment;
};

const getDistanceFromPolyline = function(curve, { x, y }) {
    if (curve.vdmap[x]) {
        const first = curve.vdmap[x][y];
        const second = curve.vdmap[x][y + 1];
        let val =
            first != undefined ? { x: first.x, y: first.y } : { x: FIELD_RADIUS, y: FIELD_RADIUS };

        if (second && second.x != undefined && Math.abs(val.x) > Math.abs(second.x)) {
            val.x = second.x;
        }
        if (second && second.y != undefined && Math.abs(val.y) > Math.abs(second.y)) {
            val.y = second.y;
        }
        return val;
    } else {
        return { x: FIELD_RADIUS, y: FIELD_RADIUS };
    }
};

const getCurveEndTangent = function(curve) {
    const endpoint = curve.c3;
    const control_point = curve.c2;
    return { x: 3 * (control_point.x - endpoint.x), y: 3 * (control_point.y - endpoint.y) };
};

const checkCorner = function(curveSegment, point) {
    if (equalVec(curveSegment.c0, curveSegment.c3)) return false;
    let tan;
    if (SHOULD_USE_NEW_CORNER_FINDER) {
        tan = getUnitVector(subVec(getPointAlongCurve(curveSegment, 0.95), curveSegment.c3));
    } else {
        tan = getUnitVector(getCurveEndTangent(curveSegment));
    }
    const new_segment = getUnitVector({
        x: point.x - curveSegment.c3.x,
        y: point.y - curveSegment.c3.y,
    });
    // Dot product == cos(angle) since the magnitude of unit vectors is 1
    const dot = dotProduct(tan, new_segment);
    const angle = radiansToDegrees(Math.acos(dot));

    if (angle < MAX_CORNER_ANGLE) {
        return true;
    }
};

const getSegmentMidpoint = (segment) =>
    addVec(divVec(subVec(segment.c3, segment.c0), 2), segment.c0);
const getScaledVectorDifference = (uvec) => ({
    x: uvec.x * FIELD_RADIUS,
    y: uvec.y * FIELD_RADIUS,
});
const negateVec = (vec) => ({ x: -vec.x, y: -vec.y });
const roundVec = (vec) => ({ x: Math.round(vec.x), y: Math.round(vec.y) });
const sumOfSquaresVec = (vec) => Math.pow(vec.x, 2) + Math.pow(vec.y, 2);
const magnitudeVec = (vec) => Math.sqrt(sumOfSquaresVec(vec));
const addVec = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const subVec = (a, b) => addVec(a, negateVec(b));
const multVec = (a, scalar_b) => ({ x: a.x * scalar_b, y: a.y * scalar_b });
const divVec = (a, scalar_b) => multVec(a, 1 / scalar_b);
const equalVec = (a, b) => a.x == b.x && a.y == b.y;

const dotProduct = (a, b) => a.x * b.x + a.y * b.y;
const getMagnitude = ({ x, y }, p2 = { x: 0, y: 0 }) =>
    Math.sqrt(Math.pow(x - p2.x, 2) + Math.pow(y - p2.y, 2));
const radiansToDegrees = (rad) => (rad * 180) / Math.PI;

const getDDASteps = (diff) => Math.max(Math.abs(diff.x), Math.abs(diff.y));
const getPerpindicularUnitVector = (a, b) => {
    const delta_x = b.x - a.x;
    const delta_y = b.y - a.y;
    const x = delta_y;
    const y = -delta_x;
    return getUnitVector({ x, y });
};
const getUnitVector = function({ x, y }) {
    const magnitude = getMagnitude({ x, y });
    return { x: x / magnitude, y: y / magnitude };
};

const getPointAlongCurve = function(curve, t) {
    const x = singleComponentBezier(t, curve.c0.x, curve.c1.x, curve.c2.x, curve.c3.x);
    const y = singleComponentBezier(t, curve.c0.y, curve.c1.y, curve.c2.y, curve.c3.y);
    return { x, y };
};
const singleComponentBezier = function(t, w0, w1, w2, w3) {
    return (
        w0 * Math.pow(1 - t, 3) +
        w1 * 3 * t * Math.pow(1 - t, 2) +
        w2 * 3 * Math.pow(t, 2) * (1 - t) +
        w3 * Math.pow(t, 3)
    );
};
