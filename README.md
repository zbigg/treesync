# TreeSync

Synchronize whole object trees just like JSON.

## Features

* basic serialization
    * JSON.stringify, while very convienient doesn't support many features of real objects encountered
      in Javascript jungle:
        * cycles in object graph
        * undefined
        * NaN, -Infinity, Infinity
        * Date, Regexp
        * custom class creation
* continuous object tree serialization
    * `Synchronizer` class allows sending updates of object tree in packets and deserialize these
       packets, while maintaining stable object tree

## Install

```
$ npm install @zbigg/treesync

```
Typescript typings included.

## Usage

Basic sending/receiving

```javascript
import * as treesync from '@zbigg/treesync'

function sender() {
    var someGraph = { ... };
    someChannel.write(treesync.serialize(someGraph))
}

function receiver() {
    someChannel.read.on('data', data => {
        console.log(treesync.deserialize(someGraph));
    }
}

```

Continuous sending/receiving.

```javascript
import * as treesync from '@zbigg/treesync';

function sender() {
    const synchronizer = new treesync.Synchronizer();
    var someGraph = { a: 'b' };
    someChannel.send(synchronizer.buildPacket(someGraph));
    someGraph.something = { c: 'd' }
    someChannel.send(synchronizer.buildPacket(someGraph));
    someGraph.other = [1,2,3];
    someChannel.send(synchronizer.buildPacket(someGraph));

    // each of writes above serializes only changed properties
}

function receiver() {
    const synchronizer = new treesync.Synchronizer();

    let oldGraph;
    someChannel.read.on('data', data => {
        const graph = synchronizer.decodePacket(someGraph);
        console.log("R": graph);

        // the identity of graph is stable across decodes
        if (oldGraph !== undefined) {
            assert(graph === oldGraph)
        }
        oldGrapg = graph;
    }
}

```
## Contribute

PRs accepted.

## License

MIT © Zbigniew Zagórski