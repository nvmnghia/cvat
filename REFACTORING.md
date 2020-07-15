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

## 1. Use case

### 1.1. Adding shape

When the user finishes drawing, this chain is called:

```text
on('drawstop') -> ShapeCreatorController::finish() -> ShapeCreatorModel::finish() -> ShapeCollectionModel::add() -> buildShapeModel() -> BoxModel()
```

### 1.2. Removing shape

When the user presses <kbd>Del</kbd>, the following chain is called:

```text
ShapeCollectionController::removeActiveShape() -> ShapeModel::remove() -> ShapeCollectionModel::onShapeUpdate() -> BoxView::onShapeUpdate() ->
```

After `add()`, `ShapeCollectionModel::update()` is called, notifying its subscribers (`ShapeCollectionView`, `AAModel`, `ShapeGrouperModel`) about state (shape collection) change.

The created `Model` subscribes `ShapeCollectionModel`, and is then fed to a corresponding `Controller`.

```text
buildShapeController() -> BoxController() -> ShapeController()
```
