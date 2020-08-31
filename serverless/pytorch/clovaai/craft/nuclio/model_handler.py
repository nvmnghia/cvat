"""
Model handler. Modified from test.py in clovaai/CRAFT-pytorch repo.
"""

from types import SimpleNamespace
import time
from collections import OrderedDict

import numpy as np
import torch
import torch.backends.cudnn as cudnn
from torch.autograd import Variable
import cv2
from PIL import Image

from craft import CRAFT
import craft_utils
import imgproc
import file_utils


class ModelHandler:
    def __init__(self, label: str = 'word'):
        """
        Initialize the model & default arguments.

        Parameters
        ----------
        label: str
            Name of the label. Default to 'word'.
        """

        super().__init__()

        self.args = {
            # TODO: check CUDA when build
            'cuda': False,
            'trained_model': 'model/craft_mlt_25k.pth',
            'refine': True,
            'refiner_model': 'model/craft_refiner_CTW1500.pth',
            'poly': False,
            'text_threshold': 0.7,
            'low_text': 0.4,
            'link_threshold': 0.4,
            'canvas_size': 1280,
            'mag_ratio': 1.5,
        }
        self.args = SimpleNamespace(**self.args)

        self.net = CRAFT()     # initialize
        self.label = label

        print(f'Loading weights from checkpoint ({self.args.trained_model})')
        if self.args.cuda:
            self.net.load_state_dict(ModelHandler.copyStateDict(torch.load(self.args.trained_model)))
        else:
            self.net.load_state_dict(ModelHandler.copyStateDict(torch.load(self.args.trained_model, map_location='cpu')))

        if self.args.cuda:
            self.net = self.net.cuda()
            self.net = torch.nn.DataParallel(self.net)
            cudnn.benchmark = False

        self.net.eval()

        # LinkRefiner
        self.refine_net = None
        if self.args.refine:
            from refinenet import RefineNet
            self.refine_net = RefineNet()

            print(f'Loading weights of refiner from checkpoint ({self.args.refiner_model})')
            if self.args.cuda:
                self.refine_net.load_state_dict(ModelHandler.copyStateDict(torch.load(self.args.refiner_model)))
                self.refine_net = self.refine_net.cuda()
                self.refine_net = torch.nn.DataParallel(self.refine_net)
            else:
                self.refine_net.load_state_dict(ModelHandler.copyStateDict(torch.load(self.args.refiner_model, map_location='cpu')))

            self.refine_net.eval()
            self.args.poly = True


    def infer(self, buffer: str) -> list:
        """
        Process image.

        Parameters
        ----------
        buffer : str
            Image encoded in a base64 UTF-8 string.

        Returns
        -------
        list
            List of result for CVAT. Each is an dictionary having 'label' and 'points' (array of number, not serialized).
        """

        t = time.time()
        image = imgproc.loadImage(buffer)    # loadImage() expects file path, however buffer is also accepted.
        bboxes, polys = self.test_net(self.net, image,
            self.args.text_threshold, self.args.link_threshold, self.args.low_text, self.args.cuda, self.args.poly,
            self.refine_net)
        print(f'Process image took: {time.time() - t}s')

        results = []
        for poly in polys:
            results.append({
                'label': self.label,
                'points': poly.ravel().tolist(),
                'type': 'polygon'
            })
        return results


    def test_net(self, net: CRAFT, image: np.ndarray, text_threshold: float, link_threshold: float,
        low_text: float, cuda: bool, poly: bool, refine_net=None):
        """
        Copypasta the original function to avoid running argparse code while importing.
        Heatmap code is removed.
        """

        t0 = time.time()

        # resize
        img_resized, target_ratio, size_heatmap = imgproc.resize_aspect_ratio(image,
            self.args.canvas_size, interpolation=cv2.INTER_LINEAR, mag_ratio=self.args.mag_ratio)
        ratio_h = ratio_w = 1 / target_ratio

        # preprocessing
        x = imgproc.normalizeMeanVariance(img_resized)
        x = torch.from_numpy(x).permute(2, 0, 1)    # [h, w, c] to [c, h, w]
        x = Variable(x.unsqueeze(0))                # [c, h, w] to [b, c, h, w]
        if cuda:
            x = x.cuda()

        # forward pass
        with torch.no_grad():
            y, feature = net(x)

        # make score and link map
        score_text = y[0,:,:,0].cpu().data.numpy()
        score_link = y[0,:,:,1].cpu().data.numpy()

        # refine link
        if refine_net is not None:
            with torch.no_grad():
                y_refiner = refine_net(y, feature)
            score_link = y_refiner[0,:,:,0].cpu().data.numpy()

        t0 = time.time() - t0
        t1 = time.time()

        # Post-processing
        boxes, polys = craft_utils.getDetBoxes(score_text, score_link, text_threshold, link_threshold, low_text, poly)

        # coordinate adjustment
        boxes = craft_utils.adjustResultCoordinates(boxes, ratio_w, ratio_h)
        polys = craft_utils.adjustResultCoordinates(polys, ratio_w, ratio_h)
        for k in range(len(polys)):
            if polys[k] is None: polys[k] = boxes[k]

        t1 = time.time() - t1

        return boxes, polys


    @classmethod
    def copyStateDict(cls, state_dict: dict) -> dict:
        """
        Copy a state dict.
        """

        if list(state_dict.keys())[0].startswith('module'):
            start_idx = 1
        else:
            start_idx = 0
        new_state_dict = OrderedDict()

        for k, v in state_dict.items():
            name = '.'.join(k.split('.')[start_idx:])
            new_state_dict[name] = v

        return new_state_dict
