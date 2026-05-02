# Cubism Core Runtime

Some Cubism 4 models require `live2dcubismcore.min.js` to be available before
the viewer loads the model.

If your local model does not load and the browser console mentions Cubism Core,
place the runtime file here:

```text
public/live2d-core/live2dcubismcore.min.js
```

The file is intentionally ignored by git because distribution terms depend on
the runtime package you use.
