interface TransportObject {
    id?: string;
    type: "ref" | "object" | "array" | "date" | "regex" | "undefined" | "nan" | "error" | string;
    value?: TransportValue | { [name: string]: TransportValue } | TransportValue[];
}

type TransportValue = number | string | boolean | null | TransportObject;

interface ObjectState {
    id: string;
    previousValue?: any;
    instance?: any;
    generation?: number;
}

export type PropertyFilter = (name: string) => boolean;

export interface ClassDef {
    name: string;
    constructor: new () => any;
    factory?: () => any;
    propertyFilter?: PropertyFilter;
}

export interface SerializationMessage {
    root: TransportValue;
    objects: { [id: string]: TransportObject };
}

export class SerializationContext {
    objectsToState: Map<object, ObjectState> = new Map();
    idToState: Map<string, ObjectState> = new Map();

    customClassByConstructor: Map<any, ClassDef> = new Map();
    customClassByName: Map<string, ClassDef> = new Map();

    message: SerializationMessage = { root: null, objects: {} };
    nextId: number = 0;
    generation = 0;

    addClass(classDef: ClassDef) {
        this.customClassByConstructor.set(classDef.constructor, classDef);
        this.customClassByName.set(classDef.name, classDef);
    }
}

/**
 * Determine if value is basic, imutable value transfered without possibility to be referenced.
 */
export type Leaf = null | undefined | string | boolean | number;

export function isLeaf(object: any): object is Leaf {
    return (
        object === null ||
        typeof object === "string" ||
        typeof object === "boolean" ||
        typeof object === "undefined" ||
        typeof object === "number"
    );
}

function doSerializeLeaf(object: Leaf): TransportValue {
    if (object === null) {
        return null;
    } else if (typeof object === "string") {
        return object;
    } else if (typeof object === "boolean") {
        return object;
    } else if (typeof object === "undefined") {
        return { type: "undefined" };
    } else if (typeof object === "number") {
        if (object === Number.POSITIVE_INFINITY) {
            return { type: "infinity" };
        } else if (object === Number.NEGATIVE_INFINITY) {
            return { type: "-infinity" };
        } else if (isNaN(object)) {
            return { type: "nan" };
        } else {
            return object;
        }
    } else {
        throw new Error(`doSerializeLeaf: unable to serialize '${object}' of type ${typeof object}`);
    }
}

function serializeProps(object: any, propertyFilter: PropertyFilter | undefined, context: SerializationContext) {
    const result: { [name: string]: TransportValue } = {};
    for (const prop in object) {
        if (object.hasOwnProperty(prop) && (!propertyFilter || propertyFilter(prop))) {
            result[prop] = serializeValue((object as any)[prop], context);
        }
    }
    return result;
}

function doSerializeObject(object: object, context: SerializationContext): TransportObject {
    if (Array.isArray(object)) {
        return {
            type: "array",
            value: object.map(item => serializeValue(item, context))
        };
    } else if (object instanceof Error) {
        // ensure that both stack and message are captured from Errors
        const value = serializeProps(object, undefined, context);
        value.message = object.message || object.toString();
        value.stack = object.stack || "";
        return { type: "error", value };
    } else {
        const constructor = object.constructor;
        const classDef = context.customClassByConstructor && context.customClassByConstructor.get(constructor);
        const propertyFilter = classDef && classDef.propertyFilter;
        if (classDef) {
            return { type: classDef.name, value: serializeProps(object, propertyFilter, context) };
        } else if (constructor === Date) {
            return { type: "date", value: (object as Date).getTime() };
        } else if (constructor === RegExp) {
            const regexp = object as RegExp;
            return {
                type: "regexp",
                value: {
                    source: regexp.source,
                    flags: regexp.flags
                }
            };
        } else if (object instanceof ArrayBuffer) {
            const b = new Blob([object]);

            throw new Error("doSerializeObject: ArrayBuffer not yet supported");
            // return {
            //     type: "arraybuffer",
            //     value: "TBD"
            // }
        } else {
            return { type: "object", value: serializeProps(object, propertyFilter, context) };
        }
    }
}

function doCreateInstance(object: TransportObject, context: SerializationContext): any {
    if (object.type === "array") {
        return [];
    } else if (object.type === "error") {
        return new Error("dummy-message");
    } else if (object.type === "date") {
        if (typeof object.value !== "number") {
            throw new Error(`doDeserializeObject: invalid value for date: '${object.value}'`);
        }
        return new Date(object.value as number);
    } else if (object.type === "regexp") {
        if (typeof object.value !== "object") {
            throw new Error(`doDeserializeObject: invalid value for regexp: '${object.value}'`);
        }
        const regexpValue: any = object.value;
        return new RegExp(regexpValue.source, regexpValue.flags);
    } else if (object.type === "arraybuffer") {
        throw new Error("doCreateInstance: ArrayBuffer not yet supported");
    } else {
        if (object.type === "object") {
            return {};
        } else {
            const classDef = context && context.customClassByName.get(object.type);
            if (!classDef) {
                throw new Error(`doDeserializeObject: invalid type '${object.type}'`);
            }
            if (classDef.factory) {
                const factory = classDef.factory;
                return factory();
            } else if (classDef.constructor) {
                const proto = classDef.constructor;
                return new proto();
            } else {
                throw new Error(
                    `doDeserializeObject: class '${object.type}' has neither factory or constructor defined`
                );
            }
        }
    }
}

function doFillInstanceChildren(instance: any, object: TransportObject, context: SerializationContext) {
    if (object.type === "date" || object.type === "regexp") {
        return;
    }

    if (object.type === "array") {
        if (!Array.isArray(object.value)) {
            throw new Error("doFillInstanceChildren: expected array as value for type 'array'");
        }
        const srcArray = object.value as TransportValue[];
        instance.length = srcArray.length;
        srcArray.forEach((item, i) => {
            instance[i] = deserializeValue(item, context);
        });
    } else {
        if (object.value) {
            for (const prop in object.value as {}) {
                const propValue = (object.value as any)[prop];
                if (propValue !== null && propValue !== undefined && propValue.type === "delete-prop") {
                    delete instance[prop];
                } else {
                    instance[prop] = deserializeValue(propValue, context);
                }
            }
        }
    }
}

function shalowEquals(a: any, b: any) {
    if (typeof a !== typeof b) {
        return false;
    } else if (typeof a === "number" && isNaN(a) && isNaN(b)) {
        return true;
    } else if (Array.isArray(a)) {
        const length = a.length;
        if (length !== b.length) {
            return false;
        }
        for (let i = 0; i < length; i++) {
            if (a[i] !== b[i]) {
                return false;
            }
        }
        return true;
    } else if (typeof a === "object") {
        for (let keyA in a) {
            if (!(keyA in b)) {
                return false;
            }
        }
        for (let keyB in b) {
            if (a[keyB] !== b[keyB]) {
                return false;
            }
        }
        return true;
    } else {
        return a === b;
    }
}

function shallowClone(object: any) {
    if (Array.isArray(object)) {
        return object.slice();
    }
    if (typeof object === "object") {
        return Object.assign({}, object);
    }
    if (object instanceof Date) {
        return new Date(object.getTime());
    }
    if (object instanceof RegExp) {
        return new RegExp(object.source, object.flags);
    }
    return object;
}

function serializeShareableObject(object: object, context: SerializationContext) {
    let state = context.objectsToState.get(object);
    if (state === undefined) {
        const id = (context.nextId++).toString();
        state = { id };
        context.objectsToState.set(object, state);
    }

    if (state.generation === undefined || state.generation < context.generation) {
        state.generation = context.generation;

        if (state.previousValue === undefined || shalowEquals(state.previousValue, object) === false) {
            state.previousValue = shallowClone(object);

            const value = doSerializeObject(object, context);
            value.id = state.id;
            context.message.objects[value.id] = value;
        }
    }
    return { type: "ref", value: state.id };
}

function deserializeShareableObject(object: TransportObject, context: SerializationContext) {
    const id = object.id!;
    let state = context.idToState.get(id);
    if (state === undefined) {
        state = { id };
        context.idToState.set(id, state);

        const value = doCreateInstance(object, context);
        state.instance = value;
    }

    if (state.generation === undefined || state.generation < context.generation) {
        state.generation = context.generation;

        doFillInstanceChildren(state.instance, object, context);
    }
    return state.instance;
}

export function serializeValue(object: any, context: SerializationContext): TransportValue {
    return isLeaf(object) ? doSerializeLeaf(object) : serializeShareableObject(object, context);
}

export function serialize(object: any, context?: SerializationContext): SerializationMessage {
    if (context === undefined) {
        context = new SerializationContext();
    }
    context.message = { root: null, objects: {} };
    context.message.root = serializeValue(object, context);
    context.generation++;
    return context.message;
}

export function deserializeRef(object: TransportObject, context: SerializationContext) {
    const id = object.value;
    if (typeof id !== "string") {
        throw new Error("deserialize: invalid ref: " + id);
    }
    const state = context.idToState.get(id);
    const serializedObject = context.message.objects[id];
    if (state !== undefined) {
        if (!serializedObject) {
            // no update, just return old instance
            return state.instance;
        } else {
            // update
            if (state.generation === undefined || state.generation < context.generation) {
                state.generation = context.generation;
                doFillInstanceChildren(state.instance, serializedObject, context);
            }
            return state.instance;
        }
    } else if (serializedObject) {
        return deserializeShareableObject(serializedObject, context);
    }
    throw new Error("deserialize: unknown ref: " + object.value);
}

export function deserializeValue(object: TransportValue, context: SerializationContext) {
    if (object === null) {
        return null;
    } else if (typeof object === "string") {
        return object;
    } else if (typeof object === "boolean") {
        return object;
    } else if (typeof object === "number") {
        return object;
    } else if (typeof object === "object") {
        if (object.type === "infinity") {
            return Number.POSITIVE_INFINITY;
        } else if (object.type === "-infinity") {
            return Number.NEGATIVE_INFINITY;
        } else if (object.type === "nan") {
            return Number.NaN;
        } else if (object.type === "undefined") {
            return undefined;
        } else if (object.type === "ref") {
            return deserializeRef(object, context);
        } else {
            return deserializeShareableObject(object, context);
        }
    } else {
        throw new Error("deserialize: invalid transport value: " + object);
    }
}

export function deserialize(message: SerializationMessage, context?: SerializationContext) {
    if (context === undefined) {
        context = new SerializationContext();
    }
    context.message = message;
    const root = deserializeValue(message.root, context);
    context.generation++;
    return root;
}

export type SyncPayload = string;

export class Synchronizer {
    serializationContext = new SerializationContext();

    write(object: any): SyncPayload {
        return JSON.stringify(serialize(object, this.serializationContext));
    }

    recv(payload: SyncPayload): any {
        const message = JSON.parse(payload);
        return deserialize(message, this.serializationContext);
    }
}
