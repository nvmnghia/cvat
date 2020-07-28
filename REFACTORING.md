# Refactoring log

Log & notes when adding splitting functionality in CVAT.

## 1. General & Setup

All major objects have `Model`, `Controller` (each receives `Model`) and `View` (each receives both a `Controller` and a `Model`).

Many `Model` subscribe to their `View`.

When open the UI, the `buildAnnotationUI()` is called. In that function, there's a notable line:

```js
shapeCreatorModel.subscribe(shapeCollectionModel);
```

which means that when `shapeCollectionModel` calls `notify()`, that `shapeCollectionModel` is passed to `onShapeCreatorUpdate()` of `shapeCreatorModel`.

Shapes in an interpolated series are treated as one shape, and the position is calculated when needed, using `ShapeModel::interpolate()` and related methods.

Note that the `A.subscribe(B)` in the source code stands for `A adds B as a listener`, or shorter `B subscribes A`. The choice of name is crazy.

The below text illustrates chain of subscribers. `Model`s subscribe to their `View` is not illustrated. The notation `A --func()--> B` means `A subscribes B`, or `B.subscribe(A)`, and `A` notifies `B` by calling `B.func()`.

```
ShapeCollectionView --onCollectionUpdate--> ShapeCollectionModel --onShapeUpdate--> ShapeModel
                    \                                                             /
                     \---onShapeViewUpdate---> ShapeView -----onShapeUpdate------/
```

## 2. Use case

### 2.1. Adding shape

When the user finishes drawing, this chain is called:

```text
on('drawstop') -> ShapeCreatorController::finish() -> ShapeCreatorModel::finish() -> ShapeCollectionModel::add() -> buildShapeModel() -> BoxModel()
```

### 2.2. Removing shape

Removing a shape is as simple as setting the `removed` attribute of the shape. The actual removal happens after a chain of callbacks, though the removed model can be retained in a unknown manner.

When the user presses <kbd>Del</kbd>, the following chain is called:

```text
ShapeCollectionController::removeActiveShape() -> ShapeModel::remove() -> ShapeCollectionModel::onShapeUpdate() -> BoxView::onShapeUpdate() ->
```

After `add()`, `ShapeCollectionModel::update()` is called, notifying its subscribers (`ShapeCollectionView`, `AAModel`, `ShapeGrouperModel`) about state (shape collection) change.

The created `Model` subscribes `ShapeCollectionModel`, and is then fed to a corresponding `Controller`.

```text
buildShapeController() -> BoxController() -> ShapeController()
```

### 2.3. Example structure

`data` that is passed into `BoxModel`'s constructor:

```js
data = {
    attributes: [],
    frame: 0,
    group: 0,
    label_id: 1,
    occluded: false,
    outside: false,
    xbr: 2177.1610717773438,
    xtl: 1841.552734375,
    ybr: 2175.7931518554688,
    ytl: 1583.603515625,
    z_order: 1
}
```

`activeShape`, which is a `BoxModel`:

```js
activeShape = {
    _active: true,
    _activeAttributeId: null,
    _attributes: {
        immutable: {},
        mutable: {
            0: { 1: '' }
        }
    },
    _clipToFrame: true,
    _color: {
        shape: '#AF593E',
        ui: '#AF593E'
    },
    _frame: 0,
    _getStateCallback: () => this,
    _groupId: 0,
    _hiddenShape: false,
    _hiddenText: true,
    _id: 1,
    _label: 1,
    _listeners: [ShapeCollectionModel, BoxView],
    _locked: false,
    _merge: false,
    _merging: false,
    _notifyCallbackName: 'onShapeUpdate',
    _positions: {
        0: {
            occluded: false,
            xbr: 2177.1610717773438,
            xtl: 1841.552734375,
            ybr: 2175.7931518554688,
            ytl: 1583.603515625,
            z_order: 1
        }
    },
    _removed: false,
    _selected: false,
    _serverID: undefined,
    _type: 'annotation_box',
    _updateReason: null
}
```
