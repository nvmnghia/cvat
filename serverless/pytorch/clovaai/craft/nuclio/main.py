"""
Wrapper for model_handler.py to connect to nuclio.
"""

import json, base64, io, yaml

from skimage import io as imgio
import numpy as np
import nuclio_sdk

from model_handler import ModelHandler


def init_context(context: nuclio_sdk.Context):
    context.logger.info('Init context... 0%')

    # Read the label
    function_config = yaml.safe_load(open('/opt/nuclio/function.yaml'))    # Files in this folder will be copied to /opt/nuclio. Seem to be fixed.
    labels_spec = function_config['metadata']['annotations']['spec']
    label = json.loads(labels_spec)[0]['name']    # Only care about the first label

    # Read the DL model
    model = ModelHandler(label)
    setattr(context.user_data, 'model', model)

    context.logger.info('Init context... 100%')


def handler(context: nuclio_sdk.Context, event: nuclio_sdk.Event) -> nuclio_sdk.Response:
    context.logger.info('Run CRAFT model')

    data = event.body
    buf = io.BytesIO(base64.b64decode(data['image'].encode('utf-8')))
    results = context.user_data.model.infer(buf)

    return context.Response(body=json.dumps(results), headers={},
        content_type='application/json', status_code=200)
