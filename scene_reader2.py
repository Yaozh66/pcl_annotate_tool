import re
import os
import json
from pyquaternion import Quaternion
import numpy as np
import pickle
import operator


class_names = ['car', 'truck', 'construction_vehicle', 'bus', 'trailer', 'barrier', 'motorcycle', 'bicycle', 'pedestrian', 'traffic_cone']
cls_attr_dist = {
    "barrier": {
        "cycle.with_rider": 0,
        "cycle.without_rider": 0,
        "pedestrian.moving": 0,
        "pedestrian.sitting_lying_down": 0,
        "pedestrian.standing": 0,
        "vehicle.moving": 0,
        "vehicle.parked": 0,
        "vehicle.stopped": 0,
    },
    "bicycle": {
        "cycle.with_rider": 2791,
        "cycle.without_rider": 8946,
        "pedestrian.moving": 0,
        "pedestrian.sitting_lying_down": 0,
        "pedestrian.standing": 0,
        "vehicle.moving": 0,
        "vehicle.parked": 0,
        "vehicle.stopped": 0,
    },
    "bus": {
        "cycle.with_rider": 0,
        "cycle.without_rider": 0,
        "pedestrian.moving": 0,
        "pedestrian.sitting_lying_down": 0,
        "pedestrian.standing": 0,
        "vehicle.moving": 9092,
        "vehicle.parked": 3294,
        "vehicle.stopped": 3881,
    },
    "car": {
        "cycle.with_rider": 0,
        "cycle.without_rider": 0,
        "pedestrian.moving": 0,
        "pedestrian.sitting_lying_down": 0,
        "pedestrian.standing": 0,
        "vehicle.moving": 114304,
        "vehicle.parked": 330133,
        "vehicle.stopped": 46898,
    },
    "construction_vehicle": {
        "cycle.with_rider": 0,
        "cycle.without_rider": 0,
        "pedestrian.moving": 0,
        "pedestrian.sitting_lying_down": 0,
        "pedestrian.standing": 0,
        "vehicle.moving": 882,
        "vehicle.parked": 11549,
        "vehicle.stopped": 2102,
    },
    "ignore": {
        "cycle.with_rider": 307,
        "cycle.without_rider": 73,
        "pedestrian.moving": 0,
        "pedestrian.sitting_lying_down": 0,
        "pedestrian.standing": 0,
        "vehicle.moving": 165,
        "vehicle.parked": 400,
        "vehicle.stopped": 102,
    },
    "motorcycle": {
        "cycle.with_rider": 4233,
        "cycle.without_rider": 8326,
        "pedestrian.moving": 0,
        "pedestrian.sitting_lying_down": 0,
        "pedestrian.standing": 0,
        "vehicle.moving": 0,
        "vehicle.parked": 0,
        "vehicle.stopped": 0,
    },
    "pedestrian": {
        "cycle.with_rider": 0,
        "cycle.without_rider": 0,
        "pedestrian.moving": 157444,
        "pedestrian.sitting_lying_down": 13939,
        "pedestrian.standing": 46530,
        "vehicle.moving": 0,
        "vehicle.parked": 0,
        "vehicle.stopped": 0,
    },
    "traffic_cone": {
        "cycle.with_rider": 0,
        "cycle.without_rider": 0,
        "pedestrian.moving": 0,
        "pedestrian.sitting_lying_down": 0,
        "pedestrian.standing": 0,
        "vehicle.moving": 0,
        "vehicle.parked": 0,
        "vehicle.stopped": 0,
    },
    "trailer": {
        "cycle.with_rider": 0,
        "cycle.without_rider": 0,
        "pedestrian.moving": 0,
        "pedestrian.sitting_lying_down": 0,
        "pedestrian.standing": 0,
        "vehicle.moving": 3421,
        "vehicle.parked": 19224,
        "vehicle.stopped": 1895,
    },
    "truck": {
        "cycle.with_rider": 0,
        "cycle.without_rider": 0,
        "pedestrian.moving": 0,
        "pedestrian.sitting_lying_down": 0,
        "pedestrian.standing": 0,
        "vehicle.moving": 21339,
        "vehicle.parked": 55626,
        "vehicle.stopped": 11097,
    },
}

dataroot = "/home/yaozh/data/nuscenes/nuscenes/v1.0-mini"
trackfile = "/home/yaozh/WebstormProjects/pcl_annotate_tool/data/SUSTech_data_track_infos.json"
with open(dataroot+"/SUSTech_data_infos_real.pkl", "rb") as f:
    nusc_info = pickle.load(f)



this_dir = os.path.dirname(os.path.abspath(__file__))
root_dir = os.path.join(this_dir, "data")

def get_all_scenes():
    all_scenes = get_scene_names()
    return list(map(get_one_scene, all_scenes))


def get_all_scene_desc():
    return list(nusc_info.keys())


def get_scene_names():
    scenes = os.listdir(root_dir)
    scenes = filter(lambda s: not os.path.exists(os.path.join(root_dir, s, "disable")), scenes)
    scenes = list(scenes)
    scenes.sort()
    return scenes


def get_scene_desc(s):
    scene_dir = os.path.join(root_dir, s)
    if os.path.exists(os.path.join(scene_dir, "desc.json")):
        with open(os.path.join(scene_dir, "desc.json")) as f:
            desc = json.load(f)
            return desc
    return None

def get_next_keyframe(s,frame_index):
    pass

def get_one_scene(s):
    if s[:4] == "nusc":
        return nusc_info[s]
    else:
        scene = {
            "scene": s,
            "frames": []
        }

        scene_dir = os.path.join(root_dir, s)

        frames = os.listdir(os.path.join(scene_dir, "lidar"))

        # print(s, frames)
        frames.sort()

        scene["lidar_ext"] = "pcd"
        for f in frames:
            filename, fileext = os.path.splitext(f)
            scene["frames"].append(filename)
            scene["lidar_ext"] = fileext

        if os.path.exists(os.path.join(scene_dir, "desc.json")):
            with open(os.path.join(scene_dir, "desc.json")) as f:
                desc = json.load(f)
                scene["desc"] = desc

        calib = {}
        calib_camera = {}
        calib_radar = {}
        calib_aux_lidar = {}
        if os.path.exists(os.path.join(scene_dir, "calib")):
            if os.path.exists(os.path.join(scene_dir, "calib", "camera")):
                calibs = os.listdir(os.path.join(scene_dir, "calib", "camera"))
                for c in calibs:
                    calib_file = os.path.join(scene_dir, "calib", "camera", c)
                    calib_name, ext = os.path.splitext(c)
                    if os.path.isfile(calib_file) and ext == ".json":
                        # print(calib_file)
                        with open(calib_file) as f:
                            cal = json.load(f)
                            calib_camera[calib_name] = cal

            if os.path.exists(os.path.join(scene_dir, "calib", "radar")):
                calibs = os.listdir(os.path.join(scene_dir, "calib", "radar"))
                for c in calibs:
                    calib_file = os.path.join(scene_dir, "calib", "radar", c)
                    calib_name, _ = os.path.splitext(c)
                    if os.path.isfile(calib_file):
                        # print(calib_file)
                        with open(calib_file) as f:
                            cal = json.load(f)
                            calib_radar[calib_name] = cal
            if os.path.exists(os.path.join(scene_dir, "calib", "aux_lidar")):
                calibs = os.listdir(os.path.join(scene_dir, "calib", "aux_lidar"))
                for c in calibs:
                    calib_file = os.path.join(scene_dir, "calib", "aux_lidar", c)
                    calib_name, _ = os.path.splitext(c)
                    if os.path.isfile(calib_file):
                        # print(calib_file)
                        with open(calib_file) as f:
                            cal = json.load(f)
                            calib_aux_lidar[calib_name] = cal

        # camera names
        camera = []
        camera_ext = ""
        cam_path = os.path.join(scene_dir, "camera")
        if os.path.exists(cam_path):
            cams = os.listdir(cam_path)
            for c in cams:
                cam_file = os.path.join(scene_dir, "camera", c)
                if os.path.isdir(cam_file):
                    camera.append(c)

                    if camera_ext == "":
                        # detect camera file ext
                        files = os.listdir(cam_file)
                        if len(files) >= 2:
                            _, camera_ext = os.path.splitext(files[0])

        if camera_ext == "":
            camera_ext = ".jpg"
        scene["camera_ext"] = camera_ext

        # radar names
        radar = []
        radar_ext = ""
        radar_path = os.path.join(scene_dir, "radar")
        if os.path.exists(radar_path):
            radars = os.listdir(radar_path)
            for r in radars:
                radar_file = os.path.join(scene_dir, "radar", r)
                if os.path.isdir(radar_file):
                    radar.append(r)
                    if radar_ext == "":
                        # detect camera file ext
                        files = os.listdir(radar_file)
                        if len(files) >= 2:
                            _, radar_ext = os.path.splitext(files[0])

        if radar_ext == "":
            radar_ext = ".pcd"
        scene["radar_ext"] = radar_ext

        # aux lidar names
        aux_lidar = []
        aux_lidar_ext = ""
        aux_lidar_path = os.path.join(scene_dir, "aux_lidar")
        if os.path.exists(aux_lidar_path):
            lidars = os.listdir(aux_lidar_path)
            for r in lidars:
                lidar_file = os.path.join(scene_dir, "aux_lidar", r)
                if os.path.isdir(lidar_file):
                    aux_lidar.append(r)
                    if radar_ext == "":
                        # detect camera file ext
                        files = os.listdir(radar_file)
                        if len(files) >= 2:
                            _, aux_lidar_ext = os.path.splitext(files[0])

        if aux_lidar_ext == "":
            aux_lidar_ext = ".pcd"
        scene["aux_lidar_ext"] = aux_lidar_ext

        if True:  # not os.path.isdir(os.path.join(scene_dir, "bbox.xyz")):
            scene["boxtype"] = "psr"
            if camera:
                scene["camera"] = camera
            if radar:
                scene["radar"] = radar
            if aux_lidar:
                scene["aux_lidar"] = aux_lidar
            if calib_camera:
                calib["camera"] = calib_camera
            if calib_radar:
                calib["radar"] = calib_radar
            if calib_aux_lidar:
                calib["aux_lidar"] = calib_aux_lidar
        scene["calib"] = calib

    return scene

def nusc_get_all_objs(scene):
    return nusc_info[scene]["obj_stats"]

has_read = False
track_res = []
def read_annotations(scene, frame, mode="normal"):
    if scene[:4] == "nusc":
        filename = os.path.join(os.getcwd(),"data/nusc/" + scene + "/label/",frame+".json")
        if (os.path.isfile(filename)):
            with open(filename, "r") as f:
                ann = json.load(f)
            return {"anns":ann,"has_file":True,"from":"label"}
        else:
            global has_read,track_res
            filename = os.path.join(os.getcwd(),"tmp/nusc/" + scene + "/label/",frame+".json")
            if (os.path.isfile(filename)):
                with open(filename, "r") as f:
                    ann = json.load(f)
                return {"anns":ann,"has_file":True,"from":"tmp"}
            elif mode != "real":
                return {"anns":nusc_info[scene]["anns"][int(frame)],"has_file":False,"from":"gt"}
            else:
                if os.path.isfile(trackfile):
                    if not has_read:
                        with open(trackfile, "r") as f:
                            track_res = json.load(f)
                        has_read = True
                    return {"anns":track_res[nusc_info[scene]["frames"][int(frame)]],"has_file":True,"from":"track"}
                else:
                    return {"anns":[],"has_file":False,"from":"gt"}
    else:
        filename = os.path.join(root_dir, scene, "label", frame + ".json")
        if (os.path.isfile(filename)):
            with open(filename, "r") as f:
                ann = json.load(f)
                return ann
        else:
            return []


def read_ego_pose(scene, frame):
    if scene[:4] == "nusc":
        return nusc_info[scene]["ego_pose"][int(frame)]
    else:
        filename = os.path.join(root_dir, scene, "ego_pose", frame + ".json")
        if (os.path.isfile(filename)):
            with open(filename, "r") as f:
                p = json.load(f)
                return p
        else:
            return None




def _lidar_nusc_box_to_global(boxes, scene_name,frame_index):
    lidar2ego = np.array(nusc_info[scene_name]["lidar2ego"][frame_index]).reshape(4,4).T
    ego2global = np.array(nusc_info[scene_name]["ego2global"][frame_index]).reshape(4,4).T
    annos=[]
    for box in boxes:
        box.transform(lidar2ego)
        box.transform(ego2global)
        name = class_names[box.label]
        if np.sqrt(box.velocity[0] ** 2 + box.velocity[1] ** 2) > 0.2:
            if name in [
                "car",
                "construction_vehicle",
                "bus",
                "truck",
                "trailer",
            ]:
                attr = "vehicle.moving"
            elif name in ["bicycle", "motorcycle"]:
                attr = "cycle.with_rider"
            else:
                attr = None
        else:
            if name in ["pedestrian"]:
                attr = "pedestrian.standing"
            elif name in ["bus"]:
                attr = "vehicle.stopped"
            else:
                attr = None
        nusc_anno = {
            "sample_token": nusc_info[scene_name]["frames"][frame_index],
            "obj_id": box.instance_token,
            "translation": box.center.tolist(),
            "size": box.wlh.tolist(),
            "rotation": box.orientation.elements.tolist(),
            "velocity": box.velocity[:2].tolist(),
            "detection_name": name,
            "detection_score": box.score,
            "attribute_name": attr if attr is not None else max(cls_attr_dist[name].items(), key=operator.itemgetter(1))[0],
        }
        annos.append(nusc_anno)
    return annos,nusc_info[scene_name]["frames"][frame_index]


# if __name__ == "__main__":
#     print(read_annotations("nusc1", "1"))
