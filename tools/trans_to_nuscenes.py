# Copyright (c) OpenMMLab. All rights reserved.
import numpy as np
import os
from os import path as osp
from pyquaternion import Quaternion
import pickle

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
nus_categories = ('car', 'truck', 'trailer', 'bus', 'construction_vehicle',
                  'bicycle', 'motorcycle', 'pedestrian', 'traffic_cone',
                  'barrier')

nus_attributes = ('cycle.with_rider', 'cycle.without_rider',
                  'pedestrian.moving', 'pedestrian.standing',
                  'pedestrian.sitting_lying_down', 'vehicle.moving',
                  'vehicle.parked', 'vehicle.stopped', 'None')


def create_nuscenes_infos(root_path,
                          version='v1.0-trainval'):
    """Create info file of nuscene dataset.

    Given the raw data, generate its related info file in pkl format.

    Args:
        root_path (str): Path of the data root.
        version (str): Version of the data.
            Default: 'v1.0-trainval'
    """
    from nuscenes.nuscenes import NuScenes
    nusc = NuScenes(version=version, dataroot=root_path, verbose=True)

    train_scenes = nusc.scene
    train_nusc_infos = _fill_trainval_infos(nusc, train_scenes)

    metadata = dict(version=version)
    data = dict(infos=train_nusc_infos, metadata=metadata)
    info_path = osp.join(root_path, 'SUSTech_data_infos.pkl')
    with open(info_path,'wb') as f:
        pickle.dump(data, f)
    train_nusc_infos = _fill_trainval_infos_SUSTECH(nusc,train_nusc_infos)
    info_path = osp.join(root_path, 'SUSTech_data_infos_real.pkl')
    with open(info_path,'wb') as f:
        pickle.dump(train_nusc_infos, f)


def _fill_trainval_infos_SUSTECH(nusc,nusc_info):
    SUSTECH_info={}
    global2new_global=np.array([[-1,0,0,0],[0,-1,0,0],[0,0,1,0],[0,0,0,1]])
    for i,scene_info in enumerate(nusc_info):
        print("Finish converting to SUSTECH scene",i+1)
        scene = {
            "scene": "nusc"+str(i+1),
            "frames": [],
            'is_key_frame': [],
            'lidar_path': [],
            'anns':[],
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
            'calib': {"camera": {}},
            'ego_pose':[],
            'lidar2ego':[],
            'obj_stats':[]
        }
        all_objs={}
        for info in scene_info["frames"]:
            l2e_t=np.array(info['lidar2ego_translation'])
            l2e_r=Quaternion(info['lidar2ego_rotation']).rotation_matrix
            lidar2ego = np.block([[l2e_r, l2e_t[:, np.newaxis]], [np.zeros((1, 3)), 1]])
            scene['lidar2ego'].append(lidar2ego.T.flatten().tolist())

            ego_pos=np.array(info["ego2global_translation"])
            ego_ori=Quaternion(info['ego2global_rotation']).rotation_matrix
            ego2global = np.block([[ego_ori, ego_pos[:, np.newaxis]], [np.zeros((1, 3)), 1]])
            ego2global_new = global2new_global @ ego2global#new_global旋转了180度
            ego_ori  = Quaternion(matrix=ego2global_new).yaw_pitch_roll
            ego2global_new = ego2global_new.flatten().tolist()
            scene['ego_pose'].append({'x':ego2global_new[3],'y':ego2global_new[7],'z':ego2global_new[11]
            ,'pitch':ego_ori[1],'roll':ego_ori[2],'azimuth':ego_ori[0]})

            scene["anns"].append([{"psr": {"position": {"x": box[0], "y": box[1], "z": box[2]},
                        "scale": {"x": box[4], "y": box[3], "z": box[5]},
                        "rotation": {"x": box[8], "y": box[7], "z": box[6]}},
                "obj_type": info["gt_names"][j],
                'obj_id': info["gt_boxes_obj_id"][j],
                'velocity': info["gt_velocity"][j].tolist()} for j, box in enumerate(info['gt_boxes'])])
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
            scene["is_key_frame"].append(info["is_key_frame"])
            scene["lidar_path"].append(info["lidar_path"][info["lidar_path"].rfind(nusc.version):])
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

        SUSTECH_info["nusc"+str(i+1)]=scene
    return SUSTECH_info


def _fill_trainval_infos(nusc,
                         train_scenes):
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
    instances = [inst["token"] for inst in nusc.instance]
    map_obj_id = np.arange(len(instances)) + 1
    instance_map = dict(zip(instances, map_obj_id.tolist()))

    infos = []
    for i, scene in enumerate(train_scenes):
        print("Creating Scene:", i + 1)
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
#             mmcv.check_file_exist(lidar_path)

            info = {
                'is_key_frame': sd_rec['is_key_frame'],
                'lidar_token': lidar_token,
                'lidar_path': lidar_path,
                'token': sample['token'],
                'cams': dict(),
                'lidar2ego_translation': cs_record['translation'],
                'lidar2ego_rotation': cs_record['rotation'],
                'ego2global_translation': pose_record['translation'],
                'ego2global_rotation': pose_record['rotation'],
                'timestamp': sample['timestamp'],
            }
#             print("trans",info["ego2global_translation"])
#             print("rot",info['ego2global_rotation'])

            l2e_r = info['lidar2ego_rotation']
            l2e_t = info['lidar2ego_translation']
            e2g_r = info['ego2global_rotation']
            e2g_t = info['ego2global_translation']
            l2e_r_mat = Quaternion(l2e_r).rotation_matrix
            e2g_r_mat = Quaternion(e2g_r).rotation_matrix

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
            velocity = np.array(
                [nusc.box_velocity(token)[:2] for token in sample['anns']])
            valid_flag = np.array(
                [(anno['num_lidar_pts'] + anno['num_radar_pts']) > 0
                 for anno in annotations],
                dtype=bool).reshape(-1)
            # convert velo from global to lidar
            for j in range(len(boxes)):
                velo = np.array([*velocity[j], 0.0])
                velo = velo @ np.linalg.inv(e2g_r_mat).T @ np.linalg.inv(
                    l2e_r_mat).T
                velocity[j] = velo[:2]
            velocity[velocity != velocity] = 999

            names = [b.name for b in boxes]
            for j in range(len(names)):
                if names[j] in NameMapping:
                    names[j] = NameMapping[names[j]]
            names = np.array(names)
            # we need to convert rot to SECOND format.
            #rots[:, 0] = -rots[:, 0] - np.pi / 2
            gt_boxes = np.concatenate([locs, dims, rots], axis=1)
            assert len(gt_boxes) == len(annotations), f'{len(gt_boxes)}, {len(annotations)}'
            info['gt_boxes'] = gt_boxes
            info['gt_names'] = names
            info['gt_velocity'] = velocity.reshape(-1, 2)
            info['num_lidar_pts'] = np.array(
                [a['num_lidar_pts'] for a in annotations])
            info['num_radar_pts'] = np.array(
                [a['num_radar_pts'] for a in annotations])
            info['valid_flag'] = valid_flag
            info["gt_boxes_obj_id"] = [instance_map[box.instance_token] for box in boxes]
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

    extrinsic = np.block([[R, -R @ T[:, np.newaxis]], [np.zeros((1, 3)), 1]])
    intrinsic = np.array(sweep['cam_intrinsic'])
    viewpad = np.eye(4)
    viewpad[:intrinsic.shape[0], :intrinsic.shape[1]] = intrinsic
    lidar2img_rt = (viewpad @ extrinsic)
    sweep['extrinsics'] = extrinsic.astype(np.float32)
    sweep['lidar2img'] = lidar2img_rt.astype(np.float32)

    return sweep
