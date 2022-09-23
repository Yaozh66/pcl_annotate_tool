import numpy as np
import copy
from scipy.optimize import linear_sum_assignment as linear_assignment

has_tracked_tracks = {}
hungarian = False
max_age = 3
unknown_num = 0

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
    'construction_vehicle':3,
    'traffic_cone':1,
    'barrier':2
}
class_names = list(NUSCENE_CLS_VELOCITY_ERROR.keys())


def greedy_assignment(dist):
    matched_indices = []
    if dist.shape[1] == 0:
        return np.array(matched_indices, np.int32).reshape(-1, 2)
    for i in range(dist.shape[0]):
        j = dist[i].argmin()
        if dist[i][j] < 1e16:
            dist[:, j] = 1e18
            matched_indices.append([i, j])
    return np.array(matched_indices, np.int32).reshape(-1, 2)


def step_centertrack(results, time_lag,track_frame_index):
    global has_tracked_tracks, unknown_num
    if len(results) == 0:
        has_tracked_tracks[track_frame_index]=[]
        return []
    else:
        self_tracks = has_tracked_tracks[track_frame_index-1] if (track_frame_index-1) in has_tracked_tracks.keys() else []
        temp = []
        for det in results:
            det['ct'] = np.array([det['globalpsr']['position']['x'], det['globalpsr']['position']['y']])
            det['tracking'] = np.array(det['velocity'][:2]) * -1 * time_lag
            det['label_preds'] = class_names.index(det['obj_type'])
            temp.append(det)
        results = temp

    N = len(results)
    M = len(self_tracks)
    # N X 2
    dets = np.array([det['ct'] + det['tracking'].astype(np.float32)
                     if det['velocity'][0] != 999 else det['ct'] for det in results], np.float32)
    item_cat = np.array([item['label_preds'] for item in results], np.int32)  # N
    track_cat = np.array([track['label_preds'] for track in self_tracks], np.int32)  # M
    max_diff = np.array([NUSCENE_CLS_VELOCITY_ERROR[box['obj_type']] for box in results], np.float32)
    tracks = np.array([pre_det['ct'] for pre_det in self_tracks], np.float32)  # M x 2

    if len(tracks) > 0:  # NOT FIRST FRAME
        dist = (((tracks.reshape(1, -1, 2) - dets.reshape(-1, 1, 2)) ** 2).sum(axis=2))  # N x M
        dist = np.sqrt(dist)  # absolute distance in meter

        invalid = ((dist > max_diff.reshape(N, 1)) +
                   (item_cat.reshape(N, 1) != track_cat.reshape(1, M))) > 0

        dist = dist + invalid * 1e18
        if hungarian:
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

    if hungarian:
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
    for m in matches.tolist():
        track = results[m[0]]
        track['obj_id'] = self_tracks[m[1]]['obj_id']
        track['age'] = 1
        track['active'] = self_tracks[m[1]]['active'] + 1
        track["det_index"] = m[0]
        ret.append(track)

    for i in unmatched_dets:
        track = results[i]
        if "obj_id" not in track.keys():
            unknown_num -= 1
            track['obj_id'] = unknown_num
        track['age'] = 1
        track['active'] = 1
        track["det_index"] = i
        ret.append(track)

    # still store unmatched tracks if its age doesn't exceed max_age, however, we shouldn't output
    # the object in current frame
    for i in unmatched_tracks:
        track = self_tracks[i]
        if track['age'] < max_age:
            track['age'] += 1
            track['active'] = 0
            ct = track['ct']
            # movement in the last second
            if 'tracking' in track:
                offset = track['tracking'] * -1  # move forward
                track['ct'] = ct + offset
            ret.append(track)

    has_tracked_tracks[track_frame_index] = ret

    return ret
