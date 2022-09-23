# Copyright (c) OpenMMLab. All rights reserved.
import numpy as np
import os
from os import path as osp
from pyquaternion import Quaternion
import pickle
from functools import reduce
from typing import List
from tqdm import tqdm
import copy
from tools.my_nuscenes.utils.data_classes import Box
from tools.my_nuscenes.utils.geometry_utils import transform_matrix
from pyquaternion import Quaternion
import json

class_names = ['car', 'truck', 'construction_vehicle', 'bus', 'trailer', 'barrier', 'motorcycle', 'bicycle',
               'pedestrian', 'traffic_cone']

NameMapping = {
    'movable_object.barrier': 'barrier',
    'vehicle.bicycle': 'bicycle',
    'vehicle.bus.bendy': 'bus',
    'vehicle.bus.rigid': 'bus',
    'vehicle.car': 'car',
    'vehicle.construction': 'construction_vehicle',
    'vehicle.motorcycle': 'motorcycle',
    'human.pedestrian.adult': 'pedestrian',
    'human.pedestrian.child': 'pedestrian',
    'human.pedestrian.construction_worker': 'pedestrian',
    'human.pedestrian.police_officer': 'pedestrian',
    'movable_object.trafficcone': 'traffic_cone',
    'vehicle.trailer': 'trailer',
    'vehicle.truck': 'truck'
}

general_to_detection = {
    "human.pedestrian.adult": "pedestrian",
    "human.pedestrian.child": "pedestrian",
    "human.pedestrian.wheelchair": "ignore",
    "human.pedestrian.stroller": "ignore",
    "human.pedestrian.personal_mobility": "ignore",
    "human.pedestrian.police_officer": "pedestrian",
    "human.pedestrian.construction_worker": "pedestrian",
    "animal": "ignore",
    "vehicle.car": "car",
    "vehicle.motorcycle": "motorcycle",
    "vehicle.bicycle": "bicycle",
    "vehicle.bus.bendy": "bus",
    "vehicle.bus.rigid": "bus",
    "vehicle.truck": "truck",
    "vehicle.construction": "construction_vehicle",
    "vehicle.emergency.ambulance": "ignore",
    "vehicle.emergency.police": "ignore",
    "vehicle.trailer": "trailer",
    "movable_object.barrier": "barrier",
    "movable_object.trafficcone": "traffic_cone",
    "movable_object.pushable_pullable": "ignore",
    "movable_object.debris": "ignore",
    "static_object.bicycle_rack": "ignore",
}

det_thresh = 0.2


def quaternion_yaw(q: Quaternion) -> float:
    """
    Calculate the yaw angle from a quaternion.
    Note that this only works for a quaternion that represents a box in lidar or global coordinate frame.
    It does not work for a box in the camera frame.
    :param q: Quaternion of interest.
    :return: Yaw angle in radians.
    """

    # Project into xy plane.
    v = np.dot(q.rotation_matrix, np.array([1, 0, 0]))
    # Measure yaw using arctan.
    yaw = np.arctan2(v[1], v[0])
    return yaw


def create_nuscenes_infos(root_path,
                          version='v1.0-trainval'):
    """Create info file of nuscene dataset.

    Given the raw data, generate its related info file in pkl format.

    Args:
        root_path (str): Path of the data root.
        version (str): Version of the data.
            Default: 'v1.0-trainval'
    """
#     from my_nuscenes.nuscenes import NuScenes
#     nusc = NuScenes(version=version, dataroot=root_path, verbose=True)
#
#     info_path = osp.join(root_path, 'SUSTech_data_infos.pkl')
#     if not osp.exists(info_path):
#         train_scenes = nusc.scene
#         train_nusc_infos = _fill_trainval_infos(nusc, train_scenes)
#         metadata = dict(version=version)
#         data = dict(infos=train_nusc_infos, metadata=metadata)
#         with open(info_path, 'wb') as f:
#             pickle.dump(data, f)
#     else:
#         with open(info_path, 'rb') as f:
#             train_nusc_infos = pickle.load(f)["infos"]
#
    info_path = osp.join(root_path, 'SUSTech_data_infos_real.pkl')
    if not osp.exists(info_path):
        train_nusc_infos1 = _fill_trainval_infos_SUSTECH(nusc, train_nusc_infos)
        with open(info_path, 'wb') as f:
            pickle.dump(train_nusc_infos1, f)
    else:
        with open(info_path, 'rb') as f:
            train_nusc_infos1 = pickle.load(f)

#     det_infos = convert_detection_file(train_nusc_infos1)
#     info_path = osp.joinoutput_val(root_path, 'SUSTech_data_det_infos.json')
#     with open(info_path, 'w') as f:
#         json.dump(det_infos, f)

    track_infos = convert_tracking_file(train_nusc_infos1)
    info_path = osp.join(root_path, 'SUSTech_data_track_infos.json')
    with open(info_path, 'w') as f:
        json.dump(track_infos, f)

def convert_tracking_file(sustech_info):
    with open("/home/yaozh/WebstormProjects/my_pcl_annotate/outputs/output_mini/tracking_result/tracking_result.json",
                  'r') as f:
        det_res = json.load(f)["results"]
        res = {}
        for frame_token, det in tqdm(det_res.items()):
            scene_name = None
            for scene_name in sustech_info.keys():
                if frame_token in sustech_info[scene_name]["frames"]:
                    break
            frame_index = sustech_info[scene_name]["frames"].index(frame_token)
            boxes = nusc_det_to_nusc_box(det)
            globalboxes = copy.deepcopy(boxes)
            lidar_boxes = _global_nusc_box_to_lidar(sustech_info, boxes, scene_name, frame_index)
            anns = []
            for i, box in enumerate(lidar_boxes):
                if box.score < 0.2:
                    continue
                loc = box.center
                ori = box.orientation.yaw_pitch_roll
                size = box.wlh
                global_loc = globalboxes[i].center
                global_ori = globalboxes[i].orientation.yaw_pitch_roll
                anns.append({"psr": {"position": {"x": loc[0], "y": loc[1], "z": loc[2]},
                                     "scale": {"x": size[1], "y": size[0], "z": size[2]},
                                     "rotation": {"x": ori[2], "y": ori[1], "z": ori[0]}},
                             "score": box.score,
                             "obj_type": box.name,
                             'velocity': globalboxes[i].velocity[:2].tolist(),
                             "globalpsr": {"position": {"x": global_loc[0], "y": global_loc[1], "z": global_loc[2]},
                                           "rotation": {"x": global_ori[2], "y": global_ori[1], "z": global_ori[0]}
                                           },
                             "obj_id": box.instance_token,
                             "timestamp": sustech_info[scene_name]["timestamp"][frame_index]})
            res.update({frame_token: anns})
        return res




def convert_detection_file(sustech_info):
    with open("/home/yaozh/WebstormProjects/my_pcl_annotate/infos_trainval_10sweeps_withvelo_filter_True.json",
              'r') as f:
        det_res = json.load(f)["results"]
    res = {}
    for frame_token, det in tqdm(det_res.items()):
        scene_name = None
        for scene_name in sustech_info.keys():
            if frame_token in sustech_info[scene_name]["frames"]:
                break
        frame_index = sustech_info[scene_name]["frames"].index(frame_token)
        boxes = nusc_det_to_nusc_box(det)
        globalboxes = copy.deepcopy(boxes)
        lidar_boxes = _global_nusc_box_to_lidar(sustech_info, boxes, scene_name, frame_index)
        anns = []
        for i, box in enumerate(lidar_boxes):
            if box.score < 0.2:
                continue
            loc = box.center
            ori = box.orientation.yaw_pitch_roll
            size = box.wlh
            global_loc = globalboxes[i].center
            global_ori = globalboxes[i].orientation.yaw_pitch_roll
            anns.append({"psr": {"position": {"x": loc[0], "y": loc[1], "z": loc[2]},
                                 "scale": {"x": size[1], "y": size[0], "z": size[2]},
                                 "rotation": {"x": ori[2], "y": ori[1], "z": ori[0]}},
                         "score": box.score,
                         "obj_type": box.name,
                         'velocity': globalboxes[i].velocity[:2].tolist(),
                         "globalpsr": {"position": {"x": global_loc[0], "y": global_loc[1], "z": global_loc[2]},
                                       "rotation": {"x": global_ori[2], "y": global_ori[1], "z": global_ori[0]}
                                       },
                         "timestamp": sustech_info[scene_name]["timestamp"][frame_index]})
        res.update({frame_token: anns})
    return res


def _fill_trainval_infos_SUSTECH(nusc, nusc_info):
    SUSTECH_info = {}
    global2new_global = np.array([[-1, 0, 0, 0], [0, -1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]])
    for i, scene_info in tqdm(enumerate(nusc_info)):
        scene = {
            "scene": "nusc" + str(i + 1),
            "frames": [],
            "timestamp": [],
            'is_key_frame': [],
            'radar_path':[],
            'lidar_path': [],
            'anns': [],
            'camera_path': {'CAM_FRONT': [], 'CAM_FRONT_RIGHT': [], 'CAM_FRONT_LEFT': [],
                            'CAM_BACK': [], 'CAM_BACK_LEFT': [], 'CAM_BACK_RIGHT': []},
            'camera': [
                'CAM_FRONT',
                'CAM_FRONT_RIGHT',
                'CAM_FRONT_LEFT',
                'CAM_BACK',
                'CAM_BACK_LEFT',
                'CAM_BACK_RIGHT',
            ],
            'calib': {"camera": {},"radar":{}},
            'ego_pose': [],
            'lidar2ego': [],
            'ego2lidar': [],
            'global2ego': [],
            'ego2global': [],
            'obj_stats': []
        }
        all_objs = {}
        for info in scene_info["frames"]:
            l2e_t = np.array(info['lidar2ego_translation'])
            l2e_r = Quaternion(info['lidar2ego_rotation']).rotation_matrix
            lidar2ego = np.block([[l2e_r, l2e_t[:, np.newaxis]], [np.zeros((1, 3)), 1]])
            scene['lidar2ego'].append(lidar2ego.T.flatten().tolist())
            scene['ego2lidar'].append(np.linalg.inv(lidar2ego).T.flatten().tolist())

            ego_pos = np.array(info["ego2global_translation"])
            ego_ori = Quaternion(info['ego2global_rotation']).rotation_matrix
            ego2global = np.block([[ego_ori, ego_pos[:, np.newaxis]], [np.zeros((1, 3)), 1]])
            scene['ego2global'].append(ego2global.T.flatten().tolist())
            scene['global2ego'].append(np.linalg.inv(ego2global).T.flatten().tolist())

#             ego2global_new = global2new_global @ ego2global  # new_global旋转了180度
            ego_ori = Quaternion(matrix=ego2global).yaw_pitch_roll
#             ego2global_new = ego2global_new.flatten().tolist()
            scene['ego_pose'].append({'x': ego_pos[0], 'y': ego_pos[1], 'z': ego_pos[2]
                                         , 'pitch': ego_ori[1], 'roll': ego_ori[2], 'azimuth': ego_ori[0]})

            scene["anns"].append([{"psr": {"position": {"x": box[0], "y": box[1], "z": box[2]},
                                           "scale": {"x": box[4], "y": box[3], "z": box[5]},
                                           "rotation": {"x": box[8], "y": box[7], "z": box[6]}},
                                   "obj_type": info["gt_names"][j],
                                   'obj_id': info["gt_boxes_obj_id"][j],
                                   'velocity': info["gt_velocity"][j].tolist(),
                                   'timestamp': info['timestamp']} for j, box in
                                  enumerate(info['gt_boxes'])])
            for j, box in enumerate(info['gt_boxes']):
                k = info["gt_names"][j] + "-" + str(info["gt_boxes_obj_id"][j])
                if all_objs.get(k):
                    all_objs[k]['count'] += 1
                else:
                    all_objs[k] = {
                        "category": info["gt_names"][j],
                        "id": info["gt_boxes_obj_id"][j],
                        "count": 1
                    }
            scene["frames"].append(info["token"])
            scene["timestamp"].append(info["timestamp"])
            scene["is_key_frame"].append(info["is_key_frame"])
            scene["lidar_path"].append(info["lidar_path"][info["lidar_path"].rfind(nusc.version):])
            scene["radar_path"].append(info["radar_path"])
            scene["calib"]["radar"] = info["radar_para"]
            if info == scene_info["frames"][0]:
                calib_camera = {'CAM_FRONT': {}, 'CAM_FRONT_RIGHT': {}, 'CAM_FRONT_LEFT': {},
                                'CAM_BACK': {}, 'CAM_BACK_LEFT': {}, 'CAM_BACK_RIGHT': {}}
                for cam in scene["camera"]:
                    calib_camera[cam]["intrinsic"] = info["cams"][cam]["cam_intrinsic"].flatten().tolist()
                    calib_camera[cam]["extrinsic"] = info["cams"][cam]["extrinsics"].flatten().tolist()
                scene["calib"]["camera"] = calib_camera

            for cam in scene["camera"]:
                scene["camera_path"][cam].append(
                    info["cams"][cam]['data_path'][info["cams"][cam]['data_path'].rfind(nusc.version):])
        scene["boxtype"] = "psr"
        scene["obj_stats"] = [x for x in all_objs.values()]

        SUSTECH_info["nusc" + str(i + 1)] = scene
    return SUSTECH_info

radar_names=["RADAR_BACK_LEFT","RADAR_BACK_RIGHT","RADAR_FRONT","RADAR_FRONT_LEFT","RADAR_FRONT_RIGHT"]
radar_colors = [[0.0,1.0,0.0],[1.0,0.0,0.0],[0.0,0.0,1.0],[1.0,1.0,0.0],[1.0,0.0,1.0]]
def _fill_trainval_infos(nusc, train_scenes, nsweeps=10, for_detection=False, filter_zero=True):
    """Generate the train/val infos from the raw data.

    Args:
        nusc (:obj:`NuScenes`): Dataset class in the nuScenes dataset.
        train_scenes (list[str]): Basic information of training scenes.
        val_scenes (list[str]): Basic information of validation scenes.
        test (bool): Whether use the test mode. In the test mode, no
            annotations can be accessed. Default: False.

    Returns:
        tuple[list[dict]]: Information of training set and validation set
            that will be saved to the info file.
    """
    # Notice: the timestamp has been multiplied by 1e-6
    instance_map = {}
    for i, scene in enumerate(train_scenes):
        instances_scene = []
        sample = nusc.get('sample', scene['first_sample_token'])
        while True:
            annotations = [
                nusc.get('sample_annotation', token)
                for token in sample['anns'] if
                nusc.get('sample_annotation', token)['category_name'] in NameMapping
            ]
            for entry in annotations:
                instances_scene.append(entry['instance_token'])
            next_token = sample["next"]
            if next_token == '':
                break
            sample = nusc.get('sample', next_token)
        instances_scene = list(set(instances_scene))
        map_obj_id = np.arange(len(instances_scene)) + 1
        instance_map.update(dict(zip(instances_scene, map_obj_id.tolist())))

    infos = []
    for i, scene in tqdm(enumerate(train_scenes)):
        scene_info = {
            "scene": scene["token"],
            "frames": [],
        }
        first_frame = nusc.get('sample', scene['first_sample_token'])
        sample = first_frame
        while True:
            lidar_token = sample['data']['LIDAR_TOP']
            sd_rec = nusc.get('sample_data', sample['data']['LIDAR_TOP'])
            cs_record = nusc.get('calibrated_sensor',
                                 sd_rec['calibrated_sensor_token'])
            pose_record = nusc.get('ego_pose', sd_rec['ego_pose_token'])
            lidar_path, boxes, _ = nusc.get_sample_data(lidar_token)
            ref_time = 1e-6 * sd_rec["timestamp"]

            ref_from_car = transform_matrix(
                cs_record["translation"], Quaternion(cs_record["rotation"]), inverse=True
            )
            # Homogeneous transfodamation matrix from global to _current_ ego car frame
            car_from_global = transform_matrix(
                pose_record["translation"],
                Quaternion(pose_record["rotation"]),
                inverse=True,
            )

            l2e_r = cs_record['rotation']
            l2e_t = cs_record['translation']
            e2g_r = pose_record['rotation']
            e2g_t = pose_record['translation']
            l2e_r_mat = Quaternion(l2e_r).rotation_matrix
            e2g_r_mat = Quaternion(e2g_r).rotation_matrix

            radar_paths = {}
            radar_paras = {}
            for i,radar_name in enumerate(radar_names):
                radar_token = sample['data'][radar_name]
                radar_path, _, _ = nusc.get_sample_data(radar_token)
                radar_paths[radar_name] = radar_path[radar_path.rfind(nusc.version):]
                radar_info = obtain_sensor2top(nusc, radar_token, l2e_t, l2e_r_mat,e2g_t, e2g_r_mat, radar_name)
                radar_para={"cssStyleSelector":"radar-points","color":radar_colors[i],"translation":radar_info["sensor2lidar_translation"].tolist(),
                "rotation":Quaternion(matrix=radar_info["sensor2lidar_rotation"]).yaw_pitch_roll,"point_size":4,"disable":False}
                radar_paras[radar_name] = radar_para


            info = {
                'is_key_frame': sd_rec['is_key_frame'],
                'lidar_token': lidar_token,
                'lidar_path': lidar_path,
                'radar_path': radar_paths,
                'radar_para':radar_paras,
                'token': sample['token'],
                'cams': dict(),
                'lidar2ego_translation': cs_record['translation'],
                'lidar2ego_rotation': cs_record['rotation'],
                'ego2global_translation': pose_record['translation'],
                'ego2global_rotation': pose_record['rotation'],
                'timestamp': sample['timestamp'] * 1e-6,
                'ref_from_car': ref_from_car,
                "sweeps": [],
                "car_from_global": car_from_global,
                "ref_time": ref_time,
            }

            if for_detection:
                sample_data_token = sample["data"]['LIDAR_TOP']
                curr_sd_rec = nusc.get("sample_data", sample_data_token)
                sweeps = []
                while len(sweeps) < nsweeps - 1:
                    if curr_sd_rec["prev"] == "":
                        if len(sweeps) == 0:
                            sweep = {
                                "lidar_path": lidar_path,
                                "sample_data_token": curr_sd_rec["token"],
                                "transform_matrix": None,
                                "time_lag": curr_sd_rec["timestamp"] * 0,
                            }
                            sweeps.append(sweep)
                        else:
                            sweeps.append(sweeps[-1])
                    else:
                        curr_sd_rec = nusc.get("sample_data", curr_sd_rec["prev"])
                        # Get past pose
                        current_pose_rec = nusc.get("ego_pose", curr_sd_rec["ego_pose_token"])
                        global_from_car = transform_matrix(
                            current_pose_rec["translation"],
                            Quaternion(current_pose_rec["rotation"]),
                            inverse=False,
                        )

                        # Homogeneous transformation matrix from sensor coordinate frame to ego car frame.
                        current_cs_rec = nusc.get(
                            "calibrated_sensor", curr_sd_rec["calibrated_sensor_token"]
                        )
                        car_from_current = transform_matrix(
                            current_cs_rec["translation"],
                            Quaternion(current_cs_rec["rotation"]),
                            inverse=False,
                        )

                        tm = reduce(
                            np.dot,
                            [ref_from_car, car_from_global, global_from_car, car_from_current],
                        )

                        lidar_path = nusc.get_sample_data_path(curr_sd_rec["token"])

                        time_lag = ref_time - 1e-6 * curr_sd_rec["timestamp"]

                        sweep = {
                            "lidar_path": lidar_path,
                            "sample_data_token": curr_sd_rec["token"],
                            "transform_matrix": tm,
                            "global_from_car": global_from_car,
                            "car_from_current": car_from_current,
                            "time_lag": time_lag,
                        }
                        sweeps.append(sweep)
                info["sweeps"] = sweeps
                assert (len(info["sweeps"]) == nsweeps - 1)

                annotations = [
                    nusc.get("sample_annotation", token) for token in sample["anns"]
                ]

                mask = np.array([(anno['num_lidar_pts'] + anno['num_radar_pts']) > 0 for anno in annotations],
                                dtype=bool).reshape(-1)

                locs = np.array([b.center for b in boxes]).reshape(-1, 3)
                dims = np.array([b.wlh for b in boxes]).reshape(-1, 3)
                velocity = np.array([b.velocity for b in boxes]).reshape(-1, 3)
                rots = np.array([quaternion_yaw(b.orientation) for b in boxes]).reshape(
                    -1, 1
                )
                names = np.array([b.name for b in boxes])
                tokens = np.array([b.token for b in boxes])
                gt_boxes = np.concatenate(
                    [locs, dims, velocity[:, :2], -rots - np.pi / 2], axis=1
                )

                assert len(annotations) == len(gt_boxes) == len(velocity)
                if not filter_zero:
                    info["gt_boxes"] = gt_boxes
                    info["gt_boxes_velocity"] = velocity
                    info["gt_names"] = np.array([general_to_detection[name] for name in names])
                    info["gt_boxes_token"] = tokens
                else:
                    info["gt_boxes"] = gt_boxes[mask, :]
                    info["gt_boxes_velocity"] = velocity[mask, :]
                    info["gt_names"] = np.array([general_to_detection[name] for name in names])[mask]
                    info["gt_boxes_token"] = tokens[mask]

            else:


                # obtain 6 image's information per frame
                camera_types = [
                    'CAM_FRONT',
                    'CAM_FRONT_RIGHT',
                    'CAM_FRONT_LEFT',
                    'CAM_BACK',
                    'CAM_BACK_LEFT',
                    'CAM_BACK_RIGHT',
                ]
                for cam in camera_types:
                    cam_token = sample['data'][cam]
                    cam_info = obtain_sensor2top(nusc, cam_token, l2e_t, l2e_r_mat,
                                                 e2g_t, e2g_r_mat, cam)
                    info['cams'].update({cam: cam_info})
                boxes = [box for box in boxes if box.name in list(NameMapping.keys())]

                # obtain annotation
                annotations = [
                    nusc.get('sample_annotation', token)
                    for token in sample['anns'] if
                    nusc.get('sample_annotation', token)['category_name'] in NameMapping
                ]

                locs = np.array([b.center for b in boxes]).reshape(-1, 3)
                dims = np.array([b.wlh for b in boxes]).reshape(-1, 3)
                rots = np.array([b.orientation.yaw_pitch_roll
                                 for b in boxes]).reshape(-1, 3)
                velocity = np.array([b.velocity[:2] for b in boxes])
                valid_flag = np.array(
                    [(anno['num_lidar_pts'] + anno['num_radar_pts']) > 0
                     for anno in annotations],
                    dtype=bool).reshape(-1)
                velocity[velocity != velocity] = 999  # fill the nan
                velocity = velocity.reshape(-1, 2)
                names = [b.name for b in boxes]
                for j in range(len(names)):
                    if names[j] in NameMapping:
                        names[j] = NameMapping[names[j]]
                names = np.array(names)
                # we need to convert rot to SECOND format.
                # rots[:, 0] = -rots[:, 0] - np.pi / 2
                gt_boxes = np.concatenate([locs, dims, rots], axis=1)
                ids = np.array([instance_map[box.instance_token] for box in boxes])
                if filter_zero:
                    gt_boxes = gt_boxes[valid_flag, :]
                    names = names[valid_flag]
                    velocity = velocity[valid_flag, :]
                    ids = ids[valid_flag]

                info['gt_boxes'] = gt_boxes
                info['gt_names'] = names
                info['gt_velocity'] = velocity
                info["gt_boxes_obj_id"] = ids.tolist()

            scene_info["frames"].append(info)
            next_token = sample["next"]
            if next_token == '':
                break
            sample = nusc.get('sample', next_token)
        infos.append(scene_info)
    return infos


def obtain_sensor2top(nusc,
                      sensor_token,
                      l2e_t,
                      l2e_r_mat,
                      e2g_t,
                      e2g_r_mat,
                      sensor_type='lidar'):
    """Obtain the info with RT matric from general sensor to Top LiDAR.

    Args:
        nusc (class): Dataset class in the nuScenes dataset.
        sensor_token (str): Sample data token corresponding to the
            specific sensor type.
        l2e_t (np.ndarray): Translation from lidar to ego in shape (1, 3).
        l2e_r_mat (np.ndarray): Rotation matrix from lidar to ego
            in shape (3, 3).
        e2g_t (np.ndarray): Translation from ego to global in shape (1, 3).
        e2g_r_mat (np.ndarray): Rotation matrix from ego to global
            in shape (3, 3).
        sensor_type (str): Sensor to calibrate. Default: 'lidar'.

    Returns:
        sweep (dict): Sweep information after transformation.
    """
    sd_rec = nusc.get('sample_data', sensor_token)
    cs_record = nusc.get('calibrated_sensor',
                         sd_rec['calibrated_sensor_token'])
    pose_record = nusc.get('ego_pose', sd_rec['ego_pose_token'])
    data_path = str(nusc.get_sample_data_path(sd_rec['token']))
    if os.getcwd() in data_path:  # path from lyftdataset is absolute path
        data_path = data_path.split(f'{os.getcwd()}/')[-1]  # relative path
    sweep = {
        'is_key_frame': sd_rec["is_key_frame"],
        'data_path': data_path,
        'type': sensor_type,
        'sample_data_token': sd_rec['token'],
        'sensor2ego_translation': cs_record['translation'],
        'sensor2ego_rotation': cs_record['rotation'],
        'ego2global_translation': pose_record['translation'],
        'ego2global_rotation': pose_record['rotation'],
        'timestamp': sd_rec['timestamp'],
        'cam_intrinsic': np.array(cs_record['camera_intrinsic'])
    }
    l2e_r_s = sweep['sensor2ego_rotation']
    l2e_t_s = sweep['sensor2ego_translation']
    e2g_r_s = sweep['ego2global_rotation']
    e2g_t_s = sweep['ego2global_translation']

    # obtain the RT from sensor to Top LiDAR
    # sweep->ego->global->ego'->lidar
    l2e_r_s_mat = Quaternion(l2e_r_s).rotation_matrix
    e2g_r_s_mat = Quaternion(e2g_r_s).rotation_matrix
    R = (l2e_r_s_mat.T @ e2g_r_s_mat.T) @ (
            np.linalg.inv(e2g_r_mat).T @ np.linalg.inv(l2e_r_mat).T)
    T = (l2e_t_s @ e2g_r_s_mat.T + e2g_t_s) @ (
            np.linalg.inv(e2g_r_mat).T @ np.linalg.inv(l2e_r_mat).T)
    T -= e2g_t @ (np.linalg.inv(e2g_r_mat).T @ np.linalg.inv(l2e_r_mat).T
                  ) + l2e_t @ np.linalg.inv(l2e_r_mat).T

    if sd_rec['sensor_modality'] == 'camera':
        extrinsic = np.block([[R, -R @ T[:, np.newaxis]], [np.zeros((1, 3)), 1]])
        intrinsic = np.array(sweep['cam_intrinsic'])
        viewpad = np.eye(4)
        viewpad[:intrinsic.shape[0], :intrinsic.shape[1]] = intrinsic
        lidar2img_rt = (viewpad @ extrinsic)
        sweep['extrinsics'] = extrinsic.astype(np.float32)
        sweep['lidar2img'] = lidar2img_rt.astype(np.float32)

    sweep['sensor2lidar_rotation'] = R.T  # points @ R.T + T
    sweep['sensor2lidar_translation'] = T

    return sweep


def nusc_box_to_SUSTECH(boxes):
    anns = []
    for box in boxes:
        loc = box.center
        ori = box.orientation.yaw_pitch_roll
        size = box.wlh
        anns.append({"psr": {"position": {"x": loc[0], "y": loc[1], "z": loc[2]},
                             "scale": {"x": size[1], "y": size[0], "z": size[2]},
                             "rotation": {"x": ori[2], "y": ori[1], "z": ori[0]}},
                     "obj_type": box.name,
                     'obj_id': box.instance_token, 'velocity': box.velocity[:2].tolist()})
    return anns


def SUSTECH_det_to_nusc_box(anns):
    box_list = []
    for ann in anns:
        pos = [ann["psr"]["position"][axis] for axis in ["x", "y", "z"]]
        size = [ann["psr"]["scale"][axis] for axis in ["y", "x", "z"]]
        quat = Quaternion(axis=[0, 0, 1], radians=ann["psr"]["rotation"]["z"])
        velocity = [*ann["velocity"], 0.0]
        box = Box(
            pos,
            size,
            quat,
            label=class_names.index(ann["obj_type"]),
            score=1.0,
            velocity=velocity,
            instance_token=ann["obj_id"]
        )
        box_list.append(box)
    return box_list


def nusc_det_to_nusc_box(detection):
    return [Box(record['translation'], record['size'], Quaternion(record['rotation']),
                name=record['detection_name'], score=record['detection_score'],
                velocity=[*record['velocity'], 0],
                instance_token=int(record["obj_id"]) if "obj_id" in record.keys() else int(record["tracking_id"]) if "tracking_id" in record.keys() else None,
                token='predicted') for record in detection]


def _global_nusc_box_to_lidar(nusc_info, boxes, scene_name, frame_index):
    ego2lidar = np.array(nusc_info[scene_name]["ego2lidar"][frame_index]).reshape(4, 4).T
    global2ego = np.array(nusc_info[scene_name]["global2ego"][frame_index]).reshape(4, 4).T
    boxlist = []
    for box in boxes:
        box.transform(global2ego)
        box.transform(ego2lidar)
        boxlist.append(box)
    return boxlist
