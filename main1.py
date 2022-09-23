import random
import string
import cherrypy
import os
import json
from jinja2 import Environment, FileSystemLoader

env = Environment(loader=FileSystemLoader('./'))
import algos.track
import os
import sys
import scene_reader2 as scene_reader
from tools import check_labels as check
from tools.my_nuscenes_converter import SUSTECH_det_to_nusc_box, nusc_det_to_nusc_box, nusc_box_to_SUSTECH

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(BASE_DIR)
sys.path.append(os.path.join(BASE_DIR, './algos'))



class Root(object):
    @cherrypy.expose
    def index(self, scene="", frame=""):
        tmpl = env.get_template('index1.html')
        return tmpl.render()

    @cherrypy.expose
    def icon(self):
        tmpl = env.get_template('test_icon.html')
        return tmpl.render()

    @cherrypy.expose
    def ml(self):
        tmpl = env.get_template('test_ml.html')
        return tmpl.render()

    @cherrypy.expose
    def reg(self):
        tmpl = env.get_template('registration_demo.html')
        return tmpl.render()

    @cherrypy.expose
    def view(self, file):
        tmpl = env.get_template('view.html')
        return tmpl.render()

    @cherrypy.expose
    def save_temp(self):
        rawbody = cherrypy.request.body.readline().decode('UTF-8')
        d = json.loads(rawbody)
        scene = d["scene"]
        frame = d["frame"]
        ann = d["annotation"]
        boxes = SUSTECH_det_to_nusc_box(ann)
        annos, token = scene_reader._lidar_nusc_box_to_global(boxes, scene, frame)
        nusc_path = os.path.join(os.getcwd(), "data/nusc/" + scene + "/nusc_format/")
        os.makedirs(nusc_path, exist_ok=True)
        with open(nusc_path + str(frame) + ".json", 'w') as f:
            json.dump({"results": {token: annos},
                       "meta": {"use_camera": False, "use_lidar": True, "use_radar": False, "use_map": False,
                                "use_external": False}}, f)

    @cherrypy.expose
    def saveworldlist(self):
        # cl = cherrypy.request.headers['Content-Length']
        rawbody = cherrypy.request.body.readline().decode('UTF-8')
        text = json.loads(rawbody)
        data = text["ann"]
        save_nusc = text["save_nusc"]
        for d in data:
            scene = d["scene"]
            frame = d["frame"]
            ann = d["annotation"]
            if scene[:4] == "nusc" and save_nusc:
                path = os.path.join(os.getcwd(), "data/nusc/" + scene + "/label/")
            elif scene[:4] != "nusc":
                path = os.path.join(os.getcwd(), "data/" + scene + "/label/")
            else:
                path = os.path.join(os.getcwd(), "tmp/nusc/" + scene + "/label/")
            os.makedirs(path, exist_ok=True)
            with open(path + str(frame) + ".json", 'w') as f:
                json.dump(ann, f, indent=2)
        #                 boxes = SUSTECH_det_to_nusc_box(ann)
        #                 annos,token = scene_reader._lidar_nusc_box_to_global(boxes, scene, frame)
        #                 nusc_path = os.path.join(os.getcwd(),"data/nusc/"+scene+"/nusc_format/")
        #                 os.makedirs(nusc_path, exist_ok=True)
        #                 with open(nusc_path+str(frame)+".json", 'w') as f:
        #                     json.dump({"results": {token: annos},"meta": {"use_camera": False, "use_lidar": True,"use_radar": False,"use_map": False, "use_external": False}}, f)
        return "ok"

    @cherrypy.expose
    @cherrypy.tools.json_out()
    def load_annotation(self, scene, frame, mode="normal"):
        return scene_reader.read_annotations(scene, frame,mode)

    @cherrypy.expose
    @cherrypy.tools.json_out()
    def load_ego_pose(self, scene, frame):
        return scene_reader.read_ego_pose(scene, frame)

    @cherrypy.expose
    @cherrypy.tools.json_out()
    def loadworldlist(self,mode):
        rawbody = cherrypy.request.body.readline().decode('UTF-8')
        worldlist = json.loads(rawbody)
        anns = list(map(lambda w: {
            "scene": w["scene"],
            "frame": w["frame"],
            "annotation": scene_reader.read_annotations(w["scene"], w["frame"],mode)},
                        worldlist))
        return anns

    @cherrypy.expose
    @cherrypy.tools.json_out()
    def scenemeta(self, scene):
        return scene_reader.get_one_scene(scene)

    @cherrypy.expose
    @cherrypy.tools.json_out()
    def get_has_ann(self, scene):
        res_list = {}
        scene_name = "nusc" + scene
        file_dir = "/home/yaozh/WebstormProjects/my_pcl_annotate/data/nusc/nusc" + scene + "/label/"
        if os.path.exists(file_dir):
            for file in os.listdir(file_dir):
                with open(os.path.join(file_dir, file), 'r') as f:
                    res = json.load(f)
                res_list.update({scene_reader.nusc_info[scene_name]["frames"][int(file[:file.rfind('.')])]: res})
            return res_list
        else:
            return []

    @cherrypy.expose
    @cherrypy.tools.json_out()
    def iter_centertrack(self, change, batch_mode):
        algos.track.unknown_num = 0
        rawbody = cherrypy.request.body.readline().decode('UTF-8')
        json_dict = json.loads(rawbody)
        last_time_stamp = json_dict[0]["dets"][0]["timestamp"]
        if change=="true":
            algos.track.has_tracked_tracks = {}
        batch_mode = True if batch_mode == "true" else False

        if json_dict[-1]["frame_index"] in algos.track.has_tracked_tracks.keys() and not batch_mode:
            return [{'obj_id':item['obj_id'],'det_index':item["det_index"]} for item in algos.track.has_tracked_tracks[json_dict[-1]["frame_index"]] if item["active"] != 0]

        annos = []
        for det in json_dict:
            timestamp = det["dets"][0]["timestamp"]
            time_lag = timestamp - last_time_stamp
            last_time_stamp = timestamp
            if det["frame_index"] in algos.track.has_tracked_tracks.keys():
                outputs = algos.track.has_tracked_tracks[det["frame_index"]]
            elif len(json_dict) ==1:
                return [{'obj_id':item['obj_id'],'det_index':det_index} for det_index,item in enumerate(det["dets"])]
            else:
                outputs = algos.track.step_centertrack(det["dets"], time_lag,det["frame_index"])
            if batch_mode:
                annos.append(outputs)
        if not batch_mode:
            return [{'obj_id':item['obj_id'],'det_index':item["det_index"]} for item in outputs if item["active"] != 0]
        else:
            return [[{'obj_id':item['obj_id'],'det_index':item["det_index"]} for item in outputs if item["active"] != 0] for outputs in annos]

    @cherrypy.expose
    @cherrypy.tools.json_out()
    def get_all_scene_desc(self):
        return scene_reader.get_all_scene_desc()

    @cherrypy.expose
    @cherrypy.tools.json_out()
    def objs_of_scene(self, scene,mode):
        if scene[:4] == "nusc":
            num_frame = len(scene_reader.nusc_info[scene]["frames"])
            all_objs = {}
            for frame in range(num_frame):
                anns = scene_reader.read_annotations(scene, str(frame),mode)["anns"]
                for ann in anns:
                    k = ann["obj_type"] + "-" + str(ann["obj_id"])
                    if all_objs.get(k):
                        all_objs[k]["count"] +=1
                    else:
                        all_objs[k] = {
                            "category": ann["obj_type"],
                            "id": ann["obj_id"],
                            "count": 1
                        }

            return [x for x in all_objs.values()]
        else:
            return self.get_all_objs(os.path.join("./data", scene))

    def get_all_objs(self, path):
        label_folder = os.path.join(path, "label")
        if not os.path.isdir(label_folder):
            return []

        files = os.listdir(label_folder)

        files = filter(lambda x: x.split(".")[-1] == "json", files)

        def file_2_objs(f):
            with open(f) as fd:
                boxes = json.load(fd)
                objs = [x for x in map(lambda b: {"category": b["obj_type"], "id": b["obj_id"]}, boxes)]
                return objs

        boxes = map(lambda f: file_2_objs(os.path.join(path, "label", f)), files)

        # the following map makes the category-id pairs unique in scene
        all_objs = {}
        for x in boxes:
            for o in x:
                k = str(o["category"]) + "-" + str(o["id"])
                if all_objs.get(k):
                    all_objs[k]['count'] = all_objs[k]['count'] + 1
                else:
                    all_objs[k] = {
                        "category": o["category"],
                        "id": o["id"],
                        "count": 1
                    }

        return [x for x in all_objs.values()]


if __name__ == '__main__':
    cherrypy.quickstart(Root(), '/', config="server1.conf")
else:
    application = cherrypy.Application(Root(), '/', config="server1.conf")
