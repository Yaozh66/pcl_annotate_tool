import numpy as np
from algos.track_utils import greedy_assignment
import copy
from scipy.optimize import linear_sum_assignment as linear_assignment
from collections import OrderedDict

NUSCENES_TRACKING_NAMES = [
    'bicycle',
    'bus',
    'car',
    'motorcycle',
    'pedestrian',
    'trailer',
    'truck'
]

# 99.9 percentile of the l2 velocity error distribution (per clss / 0.5 second)
# This is an earlier statistcs and I didn't spend much time tuning it.
# Tune this for your model should provide some considerable AMOTA improvement
NUSCENE_CLS_VELOCITY_ERROR = {
    'car': 4,
    'truck': 4,
    'bus': 5.5,
    'trailer': 3,
    'pedestrian': 1,
    'motorcycle': 13,
    'bicycle': 3,
}


class ObjectIdManager:
    def __init__(self, num_scene=10):
        self.maxId = [0 for _ in range(num_scene)]
        self.scene = 1

    def generateNewUniqueId(self):
        self.maxId[self.scene] += 1
        return self.maxId[self.scene]

    def setCurrentScene(self, scene):
        self.scene = scene

    def addObjectID(self, ids):
        self.maxId[self.scene] = max(ids+[self.maxId[self.scene]])


class PubTracker(object):
    def __init__(self, hungarian=False, max_age=3, num_scene=10, thresh = 0.2):
        self.hungarian = hungarian
        self.max_age = max_age
        self.num_scene = num_scene
        self.tracks = [[] for _ in range(num_scene)]
        self.has_tracked_list = [OrderedDict() for _ in range(num_scene)]
        self.id_manager = ObjectIdManager(num_scene)
        self.NUSCENE_CLS_VELOCITY_ERROR = NUSCENE_CLS_VELOCITY_ERROR
        self.scene_index = 0
        self.thresh = thresh
        self.reset()

    def set_scene(self, scene_index):
        self.scene_index = scene_index
        self.id_manager.setCurrentScene(scene_index)

    def reset(self):
        self.tracks[self.scene_index] = []

    def step_centertrack(self, results, time_lag):
        if len(results) == 0:
            self.tracks[self.scene_index] = []
            return []
        else:
            temp = []
            for det in results:
                # filter out classes not evaluated for tracking
                if det['detection_name'] not in NUSCENES_TRACKING_NAMES or det["detection_score"] < self.thresh:
                    continue
                det['ct'] = np.array(det['translation'][:2])
                det['tracking'] = np.array(det['velocity'][:2]) * -1 * time_lag
                det['label_preds'] = NUSCENES_TRACKING_NAMES.index(det['detection_name'])
                temp.append(det)
            results = temp

        N = len(results)
        M = len(self.tracks[self.scene_index])

        # N X 2
        dets = np.array([det['ct'] + det['tracking'].astype(np.float32)
                         if det['velocity'][0] != 999 else det['ct'] for det in results], np.float32)

        item_cat = np.array([item['label_preds'] for item in results], np.int32)  # N
        track_cat = np.array([track['label_preds'] for track in self.tracks[self.scene_index]], np.int32)  # M

        max_diff = np.array([self.NUSCENE_CLS_VELOCITY_ERROR[box['detection_name']] for box in results], np.float32)

        tracks = np.array([pre_det['ct'] for pre_det in self.tracks[self.scene_index]], np.float32)  # M x 2

        if len(tracks) > 0:  # NOT FIRST FRAME
            dist = (((tracks.reshape(1, -1, 2) - \
                      dets.reshape(-1, 1, 2)) ** 2).sum(axis=2))  # N x M
            dist = np.sqrt(dist)  # absolute distance in meter

            invalid = ((dist > max_diff.reshape(N, 1)) +
                       (item_cat.reshape(N, 1) != track_cat.reshape(1, M))) > 0

            dist = dist + invalid * 1e18
            if self.hungarian:
                dist[dist > 1e18] = 1e18
                matched_indices = linear_assignment(copy.deepcopy(dist))
            else:
                matched_indices = greedy_assignment(copy.deepcopy(dist))
        else:  # first few frame
            assert M == 0
            matched_indices = np.array([], np.int32).reshape(-1, 2)

        unmatched_dets = [d for d in range(dets.shape[0]) \
                          if not (d in matched_indices[:, 0])]

        unmatched_tracks = [d for d in range(tracks.shape[0]) \
                            if not (d in matched_indices[:, 1])]

        if self.hungarian:
            matches = []
            for m in matched_indices:
                if dist[m[0], m[1]] > 1e16:
                    unmatched_dets.append(m[0])
                else:
                    matches.append(m)
            matches = np.array(matches).reshape(-1, 2)
        else:
            matches = matched_indices

        ret = []
        for m in matches:
            track = results[m[0]]
            track['tracking_id'] = self.tracks[self.scene_index][m[1]]['tracking_id']
            track['age'] = 1
            track['active'] = self.tracks[self.scene_index][m[1]]['active'] + 1
            track["matched"] = True
            ret.append(track)

        for i in unmatched_dets:
            track = results[i]
            track['tracking_id'] = track["obj_id"] if "obj_id" in track.keys() else self.id_manager.generateNewUniqueId()
            track['age'] = 1
            track['active'] = 1
            track["matched"] = False
            ret.append(track)

        # still store unmatched tracks if its age doesn't exceed max_age, however, we shouldn't output
        # the object in current frame
        for i in unmatched_tracks:
            track = self.tracks[self.scene_index][i]
            if track['age'] < self.max_age:
                track['age'] += 1
                track['active'] = 0
                ct = track['ct']

                # movement in the last second
                if 'tracking' in track:
                    offset = track['tracking'] * -1  # move forward
                    track['ct'] = ct + offset
                ret.append(track)

        self.tracks[self.scene_index] = ret
        return ret
