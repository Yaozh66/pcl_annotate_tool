hungarian = False
max_age = 3
annotation_save_dir = "/home/yaozh/WebstormProjects/my_pcl_annotate/data/nusc/"
detection_file = "/home/yaozh/WebstormProjects/my_pcl_annotate/infos_trainval_10sweeps_withvelo_filter_True.json"
thresh = 0.2

from algos.pub_tracker import PubTracker as Tracker
import os
import json
from scene_reader2 import nusc_info
import copy

scene_names = list(nusc_info.keys())
tracker = Tracker(max_age=max_age, hungarian=hungarian, num_scene=len(scene_names),thresh = thresh)
with open(detection_file, 'r') as f:
    detection_result = json.load(f)
detection_result = detection_result["results"]
has_ann = []
sizemap=[]
for i,scene in enumerate(scene_names):
    tracker.id_manager.setCurrentScene(i)
    scene_ann = []
    scene_dir = annotation_save_dir + scene + "/nusc_format/"
    scene_size = {}
    if os.path.exists(scene_dir):
        exist_files = os.listdir(scene_dir)
        for file in exist_files:
            with open(scene_dir + file, 'r') as f:
                temp_res = json.load(f)
            token = list(temp_res["results"].keys())[0]
            scene_ann.append(token)
            detection_result[token] = temp_res["results"][token]
            IDs = [int(obj["obj_id"]) for obj in detection_result[token]]
            tracker.id_manager.addObjectID(IDs)
            sizelist = [obj["size"] for obj in detection_result[token]]
            scene_size.update(dict(zip(IDs,sizelist)))
    has_ann.append(scene_ann)
    sizemap.append(scene_size)


def track(scene_index, frame_index, has_modified_frames: list):
    tracker.set_scene(scene_index)
    scene_name = "nusc" + str(scene_index + 1)
    # Begin Tracking
    # First, get the first frame to start tracking
    # 从以往最近的一次有真实标注数据帧的下一帧开始跟踪
    start_frame = 0
    for prev_frame in range(frame_index, -1, -1):
        frame_token = nusc_info[scene_name]["frames"][prev_frame]
        if prev_frame in has_modified_frames:
            file_name = annotation_save_dir + scene_name + "/nusc_format/" + str(prev_frame) + ".json"
            with open(file_name, 'r') as f1:
                detection_result[frame_token] = json.load(f1)["results"][frame_token]
            has_ann[scene_index].append(frame_token)
            IDs = [int(obj["obj_id"]) for obj in detection_result[frame_token]]
            tracker.id_manager.addObjectID(IDs)
            sizelist = [obj["size"] for obj in detection_result[frame_token]]
            sizemap[scene_index].update(dict(zip(IDs,sizelist)))
            start_frame = prev_frame
            tracker.reset()
            break

        if frame_token in has_ann[scene_index]:
            start_frame = prev_frame
            tracker.reset()
            break

    if start_frame == 0:
        if len(tracker.has_tracked_list[scene_index]):
            has_tracked_frameIndex = list(tracker.has_tracked_list[scene_index].keys())
            start_frame = has_tracked_frameIndex[-1]
            if start_frame >= frame_index:
                if frame_index in has_tracked_frameIndex:
                    return tracker.has_tracked_list[scene_index][frame_index]
                else:
                    tracker.reset()
                    # if this frame has not been tracked, we find the last frame has been tracked before this frame
                    i = -1
                    for frame in has_tracked_frameIndex:
                        if frame > frame_index:
                            break
                        i += 1
                    if i > -1:
                        start_frame = has_tracked_frameIndex[i]
                        detection_result[nusc_info[scene_name]["frames"][start_frame]] = tracker.has_tracked_list[scene_index][start_frame]
                    else:
                        start_frame = 0
            else:
                detection_result[nusc_info[scene_name]["frames"][start_frame]] = tracker.has_tracked_list[scene_index][
                    start_frame]
        else:
            start_frame = 0

    if start_frame == 0:
        tracker.reset()

    last_time_stamp = nusc_info[scene_name]['timestamp'][start_frame]

    for track_frame in range(start_frame, frame_index + 1):
        timestamp = nusc_info[scene_name]["timestamp"][track_frame]
        track_token = nusc_info[scene_name]["frames"][track_frame]
        det = copy.deepcopy(detection_result[track_token])
        time_lag = (timestamp - last_time_stamp)
        last_time_stamp = timestamp
        outputs = tracker.step_centertrack(det, time_lag)
        annos = []
        for item in outputs:
            if item['active'] == 0:
                continue
            item['tracking_id'] = int(item['tracking_id'])
            nusc_anno = {
                "sample_token": track_token,
                "translation": item['translation'],
                "size":sizemap[scene_index][item['tracking_id']] if item['tracking_id'] in sizemap[scene_index].keys() else item['size'],
                "rotation": item['rotation'],
                "velocity": item['velocity'],
                "obj_id": item['tracking_id'],
                "detection_name": item['detection_name'],
                "detection_score": item['detection_score'],
                "matched": item["matched"],
            }
            annos.append(nusc_anno)
        tracker.has_tracked_list[scene_index][track_frame] = annos

    return tracker.has_tracked_list[scene_index][frame_index]