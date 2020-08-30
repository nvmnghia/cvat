"""
Wrapper for model_handler.py to connect to nuclio.
"""

import json, base64, io

from skimage import io as imgio
import numpy as np

from model_handler import ModelHandler


def init_context(context):
    context.logger.info('Init context... 0%')

    # Read the DL model
    model = ModelHandler()
    setattr(context.user_data, 'model', model)

    context.logger.info('Init context... 100%')


def handler(context, event):
    context.logger.info('Run CRAFT model')

    data = event.body
    buf = io.BytesIO(base64.b64decode(data['image'].encode('utf-8')))
    results = context.user_data.model.infer(buf)

    return context.Response(body=json.dumps(results), headers={},
        content_type='application/json', status_code=200)
