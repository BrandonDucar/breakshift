/*
 * Copyright (c) Meta Platforms, Inc. and affiliates. All Rights Reserved.
 */
/** Thrown for input the builder cannot encode as object-prompt text. */
export class ObjectPromptError extends Error {
    code;
    constructor(message, code) {
        super(message);
        this.code = code;
        this.name = new.target.name;
    }
}
const canonicalDecimal = /^(?:0|[1-9][0-9]*)$/;
function isNonNegativeInteger(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function objectIdText(id) {
    if (isNonNegativeInteger(id))
        return String(id);
    if (typeof id === 'string' &&
        canonicalDecimal.test(id) &&
        Number.isSafeInteger(Number(id))) {
        return id;
    }
    throw new ObjectPromptError(`Object id ${JSON.stringify(id)} is not a non-negative integer or its decimal string.`, 'invalid_object_id');
}
function boxToken(box, size, view) {
    const { left, top, right, bottom } = box ?? {};
    const valid = [left, top, right, bottom].every(isNonNegativeInteger) &&
        left < right &&
        top < bottom &&
        right <= size.width &&
        bottom <= size.height;
    if (!valid) {
        throw new ObjectPromptError(`Box ${JSON.stringify(box)} must have integer edges with left < right <= ${size.width} and top < bottom <= ${size.height}.`, 'invalid_box');
    }
    return `<|box;x1=${left};y1=${top};x2=${right - 1};y2=${bottom - 1};${view}|>`;
}
function pointToken(point, size, view) {
    const { x, y, label = 'positive' } = point ?? {};
    if (!isNonNegativeInteger(x) ||
        !isNonNegativeInteger(y) ||
        x >= size.width ||
        y >= size.height) {
        throw new ObjectPromptError(`Point ${JSON.stringify(point)} must have integer coordinates inside the ${size.width}x${size.height} media.`, 'invalid_point');
    }
    if (label !== 'positive' && label !== 'negative') {
        throw new ObjectPromptError(`Point label ${JSON.stringify(label)} must be 'positive' or 'negative'.`, 'invalid_point_label');
    }
    return `${label === 'negative' ? '-' : ''}<|point;x=${x};y=${y};${view}|>`;
}
/**
 * Builds object-prompt text for a SAM API request.
 *
 * Frames are emitted in ascending order, objects in input order within a frame,
 * and each object's box before its points. Throws `ObjectPromptError` for input
 * it cannot encode: a size or coordinate that is not a non-negative integer,
 * a box or point outside `size`, an empty box, an object or frame prompt with no
 * box and no points, or the same object or frame given twice.
 */
export function buildObjectPrompt(options) {
    const { size, objects } = options;
    if (size === null ||
        typeof size !== 'object' ||
        !isNonNegativeInteger(size.width) ||
        !isNonNegativeInteger(size.height) ||
        size.width === 0 ||
        size.height === 0) {
        throw new ObjectPromptError(`Size ${JSON.stringify(size)} must have positive integer width and height.`, 'invalid_size');
    }
    if (!Array.isArray(objects) || objects.length === 0) {
        throw new ObjectPromptError('At least one object is required.', 'no_objects');
    }
    const view = `w=${size.width};h=${size.height}`;
    const seenIds = new Set();
    const segmentsByFrame = new Map();
    for (const object of objects) {
        const id = objectIdText(object?.id);
        if (seenIds.has(id)) {
            throw new ObjectPromptError(`Object ${id} is given more than once; list all of its frames in one object.`, 'duplicate_object_id');
        }
        seenIds.add(id);
        if (!Array.isArray(object.prompts) || object.prompts.length === 0) {
            throw new ObjectPromptError(`Object ${id} has no prompts.`, 'empty_object');
        }
        const seenFrames = new Set();
        for (const prompt of object.prompts) {
            const frame = prompt?.frame ?? 0;
            if (!isNonNegativeInteger(frame)) {
                throw new ObjectPromptError(`Frame ${JSON.stringify(frame)} of object ${id} is not a non-negative integer.`, 'invalid_frame');
            }
            if (seenFrames.has(frame)) {
                throw new ObjectPromptError(`Object ${id} has more than one prompt on frame ${frame}.`, 'duplicate_frame');
            }
            seenFrames.add(frame);
            const points = prompt.points ?? [];
            if (prompt.box === undefined && points.length === 0) {
                throw new ObjectPromptError(`Object ${id} has neither a box nor points on frame ${frame}.`, 'empty_prompt');
            }
            const tokens = [
                ...(prompt.box === undefined ? [] : [boxToken(prompt.box, size, view)]),
                ...points.map((point) => pointToken(point, size, view)),
            ];
            const segments = segmentsByFrame.get(frame) ?? [];
            segments.push(`${id}${tokens.join('')}`);
            segmentsByFrame.set(frame, segments);
        }
    }
    return [...segmentsByFrame.keys()]
        .sort((a, b) => a - b)
        .map((frame) => `<${frame}f>${segmentsByFrame.get(frame).join(',')}`)
        .join('');
}
