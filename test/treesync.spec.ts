import { assert } from "chai";
import { serialize, deserialize, Synchronizer, SerializationContext } from "../lib/treesync";

function transfer<T>(value: T, context?: SerializationContext): T {
    const payload = JSON.stringify(serialize(value, context));
    //    console.log('T', payload);
    return deserialize(JSON.parse(payload), context);
}

function assertTransferWorks<T>(value: T): void {
    const result = transfer(value);
    if (value !== null && typeof value === "object") {
        assert.notStrictEqual(value, result);
        assert.deepEqual(result, value);
    } else {
        assert.strictEqual(result, value);
    }
}

function buildSimpleFamilyTree() {
    const mom = { age: 42, children: [] as any[], likes: "orange" };
    const bob = {
        age: 19,
        parent: mom,
        birth_date: new Date("2018-09-24T19:22"),
        likes: "apple"
    };
    const alice = { age: 23, parent: mom, likes: "rabbits" };
    mom.children = [bob, alice];
    return { mom, bob, alice };
}

describe("treesync", function() {
    describe("#serialize/#deserialize", function() {
        describe("basic types", function() {
            it("supports null", function() {
                assert.strictEqual(transfer(null), null);
                assertTransferWorks(null);
            });

            it("supports undefined", function() {
                assertTransferWorks(undefined);

                assert.strictEqual((transfer as any)(), undefined);
            });

            it("supports numbers", function() {
                assertTransferWorks(0);
                assertTransferWorks(-0);
                assertTransferWorks(-1.999);
                assertTransferWorks(Number.EPSILON);
                assertTransferWorks(-Number.EPSILON);
                assertTransferWorks(Number.MAX_SAFE_INTEGER);
                assertTransferWorks(Number.MIN_SAFE_INTEGER);
                assertTransferWorks(Number.MIN_VALUE);
                assertTransferWorks(Number.MAX_VALUE);
                assertTransferWorks(Infinity);
                assertTransferWorks(-Infinity);
                assertTransferWorks(Number.POSITIVE_INFINITY);
                assertTransferWorks(Number.NEGATIVE_INFINITY);
                assert.isNaN(transfer(NaN));
            });

            it("supports strings", function() {
                assertTransferWorks("");
                assertTransferWorks("a");
            });

            it("supports obscure unicode planes in strings", function() {
                // random stuff from: http://www.columbia.edu/~fdc/utf8/
                assertTransferWorks("ᚠᛇᚻ᛫ᛒᛦᚦ᛫ᚠᚱᚩᚠᚢᚱ᛫ᚠᛁᚱᚪ᛫ᚷᛖᚻᚹᛦᛚᚳᚢᛗ");
                assertTransferWorks("An preost wes on leoden, Laȝamon was ihoten");
                assertTransferWorks("Τη γλώσσα μου έδωσαν ελληνική"); // greek
                assertTransferWorks("На берегу пустынных волн"); // cyrrylic
                assertTransferWorks("Mogę jeść szkło i mi nie szkodzi");
                assertTransferWorks("אני יכול לאכול זכוכית וזה לא מזיק לי.");
            });

            it("supports boolean", function() {
                assertTransferWorks(true);
                assertTransferWorks(false);
            });
        });

        describe("objects & arrays", function() {
            it("supports basic objects", function() {
                assertTransferWorks({ a: 1, b: "2", c: true });
            });

            it("supports basic arrays", function() {
                assertTransferWorks([1, "a", true, NaN]);
            });

            it("supports date", function() {
                assert.deepEqual(
                    transfer(new Date("2018-09-24T19:22")).toISOString(),
                    new Date("2018-09-24T19:22").toISOString()
                );
            });

            it.skip("supports arraybufffers", function() {
                function buildArrayBufferFromString(x: string) {
                    const length = x.length;
                    const buf = new ArrayBuffer(length * 2);
                    const wordView = new Uint16Array(buf);
                    for (let i = 0; i < length; i++) {
                        wordView[i] = x.codePointAt(i) || 0;
                    }
                    return buf;
                }
                const expected = buildArrayBufferFromString("a");
                const result = transfer(buildArrayBufferFromString("a"));

                assert.instanceOf(result, ArrayBuffer);
                assert.equal(result.byteLength, expected.byteLength);

                const expectedView = new Uint8Array(expected);
                const resultView = new Uint8Array(expected);
                assert.equal(resultView, expectedView);

                //assert.deepEqual(transfer(buildArrayBufferFromString("a")), buildArrayBufferFromString("a"));
            });

            it("supports regexp", function() {
                assertTransferWorks(/abc/);
                assertTransferWorks(/abc/g);
                assertTransferWorks(/[abc]?/i);
            });

            it("supports nested objects/arrays", function() {
                assertTransferWorks([{ a: "1" }]);
                assertTransferWorks({ p: { a: "1" } });
                assertTransferWorks({ p: [1, 2, 3] });
                assertTransferWorks({ p: [1, 2, [2, 3, {}]] });
            });

            it("support Error", function() {
                let error: Error | undefined;
                try {
                    throw Error("test");
                } catch(e) {
                    error = e;
                }
                const P = serialize(error);
                const result = deserialize(P);
                assert.equal(result.message, error!.message)
                assert.equal(result.stack, error!.stack)
            })

            it("supports loops", function() {
                const a: any = { n: "a", b: null };
                const b: any = { n: "b", a };
                a.b = b;

                const ra = transfer(a);
                assert.equal(ra.n, "a");
                assert.property(ra, "b");

                const rb = ra.b;
                assert.equal(rb.n, "b");
                assert.strictEqual(ra, rb.a);
                assert.strictEqual(rb, ra.b);
            });

            it("supports self loops", function() {
                const a: any = { n: "a", self: null };
                a.self = a;

                const ra = transfer(a);
                assert.equal(ra.n, "a");
                assert.property(ra, "self");

                assert.strictEqual(ra, ra.self);
            });

            it("rich scenario", function() {
                const { mom, bob, alice } = buildSimpleFamilyTree();
                //(alice as any).x = alice;

                const bobFlattened = serialize(bob);
                const bob2 = deserialize(bobFlattened);

                assert.notEqual(bob2, bob);
                assert.equal(bob2.age, bob.age);
                assert(bob2.birth_date);
                assert.equal(bob2.birth_date.toISOString(), bob.birth_date.toISOString());
                assert(bob2.parent);

                const mom2 = bob2.parent;
                assert.notEqual(mom2, mom);
                assert.equal(mom2.age, mom.age);
                assert(mom2.children);
                assert.equal(mom2.children.length, mom.children.length);
                assert.equal(mom2.children[0], bob2);

                const alice2 = mom2.children[1];
                assert(alice2);
                assert.equal(alice2.age, alice.age);
                assert.equal(alice2.parent, mom2);
            });
        });

        describe("custom class support", function() {
            class Custom {
                private m_foo: string;

                notTransfered?: string;

                constructor(foo?: string) {
                    this.m_foo = foo || "defoo";
                }

                get foo() {
                    return this.m_foo;
                }
            }
            it("serializes custom class", function() {
                const context = new SerializationContext();
                context.addClass({ name: "custom", constructor: Custom });

                const original = new Custom("xxx");
                const result = transfer(original, context);

                assert.notStrictEqual(result, original);
                assert.instanceOf(result, Custom);
                assert.equal(result.foo, original.foo);
            });

            it("serializes custom class with property filters", function() {
                const context = new SerializationContext();
                context.addClass({
                    name: "custom",
                    constructor: Custom,
                    propertyFilter: (name: string) => {
                        return name !== "notTransfered";
                    }
                });

                const original = new Custom("xxx");
                original.notTransfered = "no!";
                const result = transfer(original, context);

                assert.instanceOf(result, Custom);
                assert.notStrictEqual(result, original);
                assert.strictEqual(result.foo, original.foo);
                assert.notProperty(result, "notTransfered");
            });
        });
    });

    describe("synchronizer", function() {
        it("synchronizes one object", function() {
            const original = { a: "1" };

            const sender = new Synchronizer();
            const payload1 = sender.write(original);

            const receiver = new Synchronizer();
            const result = receiver.recv(payload1);

            assert.notStrictEqual(original, result);
            assert.deepEqual(result, original);

            original.a = "2";
            const payload2 = sender.write(original);
            const result2 = receiver.recv(payload2);

            assert.deepEqual(result2, original);

            assert.strictEqual(result2, result);
        });

        it("synchronizes object tree", function() {
            const { mom, bob, alice } = buildSimpleFamilyTree();

            // synchronize mom
            const sender = new Synchronizer();
            const payload1 = sender.write(mom);

            const receiver = new Synchronizer();
            const mom1 = receiver.recv(payload1);
            // console.log("R", payload1);

            assert.notStrictEqual(mom, mom1);
            assert.deepEqual(mom, mom1);

            // synchonize bob (should be noop)
            bob.likes = "orange";
            const payload2 = sender.write(bob);
            const bob1 = receiver.recv(payload2);

            assert.deepEqual(bob, bob1);
            // TODO: asserts
        });
    });
});
