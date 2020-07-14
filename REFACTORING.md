# Refactoring log

Log & notes when adding splitting functionality in CVAT.

## 1. Use case

### 1.1. Adding shape

All major objects have `Model`, `Controller` (each receives `Model`) and `View` (each receives both a `Controller` and a `Model`).

Many `Model` subscribe to their `View`.

When open the UI, the `buildAnnotationUI()` is called. In that function, there's a notable line:

```js
shapeCreatorModel.subscribe(shapeCollectionModel);
```

which means that when `shapeCollectionModel` calls `notify()`, that `shapeCollectionModel` is passed to `onShapeCreatorUpdate()` of `shapeCreatorModel`.

When the user finishes drawing, this chain is called:

```text
on('drawstop')'s callback -> ShapeCreatorController::finish() -> ShapeCreatorModel::finish() -> ShapeCollectionModel::add() -> buildShapeModel() -> BoxModel() -> ShapeModel() -> Listener()
```

After `add()`, `ShapeCollectionModel::update()` is called, notifying its subscribers (`ShapeCollectionView`, `AAModel`, `ShapeGrouperModel`) about state (shape collection) change.

The created `Model` subscribes `ShapeCollectionModel`, and is then fed to a corresponding `Controller`.

```text
buildShapeController() -> BoxController() -> ShapeController()
```
