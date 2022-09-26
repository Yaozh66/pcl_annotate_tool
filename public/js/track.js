import {objIdManager} from "./obj_id_list.js";

function tracker(cfg){
    this.num_scene = cfg.num_scene;
    this.has_ann = [];
    this.sizemap = [];
    this.detection_file = cfg.detection_file;
    this.change = false;
    this.has_track_frame = [];//这个has_track_frame和track.py里面的self_tracks是同步的

    //检测结果的来源:面板具有的bbox,确定标注文件,检测结果
    this.read_det_file=function (detection_file){
        let xhr = new XMLHttpRequest();
        let _self = this;
        xhr.onreadystatechange = function () {
            if (this.readyState !== 4)
                return;
            if (this.status == 200)
                _self.det = JSON.parse(this.responseText);
        };
        xhr.open('GET', detection_file, false);
        xhr.send();
    };
    this.update_after_save=function(scene_name,frame_token,res,obj_id){
        if(!this.has_ann[scene_name])
            this.has_ann[scene_name]=[frame_token];
        else
            this.has_ann[scene_name].push(frame_token);
        if(!this.sizemap[scene_name])
            this.sizemap[scene_name]={}
        if(obj_id){
            if(this.det){
                let this_det = this.det[frame_token].find(d=>d.obj_id==obj_id);
                this_det = res.find(d=>d.obj_id==obj_id);
            }
            res.filter(r=>r.obj_id=obj_id).forEach(det=>this.sizemap[scene_name][parseInt(det["obj_id"])]=det.psr.scale);
        }
        else{
            if(this.det)
                this.det[frame_token] =res;
            res.forEach(det=>{
                if(det.psr)
                    this.sizemap[scene_name][parseInt(det["obj_id"])]=det.psr.scale
            });
        }

        this.change = true;
    }
    this.update_box=function(frame_token,box,mode){
        //update the detection result
        //修改检测结果既可以删除也可以修改，修改包含新增
        //在删除模式下，直接删除相同id号的box，否则不管
        //在修改模式下，在跟踪结果里面直接修改相同id号的box，如果没有相同id的box，则在检测结果里面新增这个box
        if(mode=="modify"){
            let box_det = this.det[frame_token].find(d=>d.obj_id == box.obj_track_id);
            if(box_det){
                if(box.psr){
                    this.sizemap[box.world.frameInfo.scene][parseInt(box.obj_track_id)]=box.psr.scale;
                    box_det.psr=box.psr;
                }
                else{
                    this.sizemap[box.world.frameInfo.scene][parseInt(box.obj_track_id)]=box.scale;
                    box_det.psr={'position':box.position,'scale':box.scale,'rotation':box.rotation};
                }
                box_det.obj_type = box.obj_type;
                box_det.globalpsr = box.globalpsr;
                box_det.velocity = box.velocity;
                box_det.score = 1;
            }
            else{
                if(box.psr){
                    this.det[frame_token].push({
                        psr:box.psr,
                        globalpsr:box.globalpsr,
                        obj_type:box.obj_type,
                        obj_id:box.obj_track_id,
                        velocity:box.velocity,
                        score: 1
                    })
                    this.sizemap[box.world.frameInfo.scene][parseInt(box.obj_track_id)]=box.psr.scale;
                }
                else{
                    this.det[frame_token].push({
                        psr:{'position':box.position,'scale':box.scale,'rotation':box.rotation},
                        globalpsr:box.globalpsr,
                        obj_type:box.obj_type,
                        obj_id:box.obj_track_id,
                        velocity:box.velocity,
                        score: 1
                    })
                    this.sizemap[box.world.frameInfo.scene][parseInt(box.obj_track_id)]=box.scale;
                }
            }
        }
        else{
            this.det[frame_token].filter(d=>d.obj_id !== box.obj_track_id||!d.obj_id);
            delete this.sizemap[box.world.frameInfo.scene][parseInt(box.obj_track_id)];
        }
        this.change = true;
    }
    this.get_has_ann_frame=function(scene_index){
        let xhr = new XMLHttpRequest();
        let _self = this;
        xhr.onreadystatechange = function () {
            if (this.readyState != 4)
                return;
            if (this.status == 200){
                let res = JSON.parse(this.responseText)
                for(let frame_token in res){
                    let scene_name = "nusc"+(scene_index+1).toString();
                    _self.update_after_save(scene_name,frame_token,res[frame_token]);
                }
            }
        };
        xhr.open('GET', `/get_has_ann?scene=${(scene_index+1).toString()}`, false);
        xhr.send();
    };
    this.track = async function (scene,frame_index,batch_mode = false,batch_selected_frames=[],batch_selected_obj_id=null,finishCB = null) {
        //check the parameters
        if((batch_mode == true && frame_index >=0) || (batch_mode == false && batch_selected_frames.length>0)){
            window.editor.infoBox.show("Error!","Track Function Set Error")
            return;
        }
        if(this.change == true)
            this.has_track_frame = []
        //determine the start tracking frame
        let start_frame = 0;
        if(batch_mode)
            frame_index = Math.min(...batch_selected_frames);
        for (let prev_frame = frame_index; prev_frame > -1; prev_frame--) {
            let frame_token = window.editor.data.meta[scene]["frames"][prev_frame];
            if(this.has_ann[scene]){
                if (this.has_ann[scene].includes(frame_token)) {
                    start_frame = prev_frame;
                    break;
                }
            }
            if (this.has_track_frame.includes(prev_frame)) {
                if(prev_frame == frame_index){
                    start_frame = prev_frame;
                    break;
                }
                else{
                    start_frame = prev_frame+1;
                    break;
                }
            }
        }

        if(batch_mode)
            frame_index = Math.max(...batch_selected_frames);
        let xhr = new XMLHttpRequest();
        let _self= this;
        xhr.onreadystatechange = function () {
            if (this.readyState !== 4) return;
            if (this.status == 200) {
                for (let track_frame = start_frame; track_frame <= frame_index; track_frame++)
                    _self.has_track_frame.push(track_frame);
                if(!batch_mode){
                    let anns = JSON.parse(this.responseText);
                    let this_world = window.editor.data.worldList.find(w=>(w.frameInfo.scene==scene && w.frameInfo.frame_index==frame_index))
                    let frame_token = window.editor.data.meta[scene]["frames"][frame_index];
                    anns.filter(b=>b.obj_id<0).forEach(b=>b.obj_id=objIdManager.generateNewUniqueId())
                    anns.forEach(b=>{
                        //匹配上的id赋给检测结果
                        _self.det[frame_token][b.det_index]["obj_id"] = b.obj_id;
                        let box = _self.det[frame_token][b.det_index];
                        if(!_self.sizemap[scene])
                            _self.sizemap[scene]={}
                        if(_self.sizemap[scene][parseInt(box.obj_id)])
                            box.psr.scale = _self.sizemap[scene][parseInt(box.obj_id)];
                        //可视化跟踪结果
                        let box1 = this_world.annotation.add_box(box.psr.position,
                            box.psr.scale,
                            box.psr.rotation,
                            box.obj_type,
                            box.obj_id);
                        box1.velocity = box.velocity;
                        box1.annotator = 't';
                        objIdManager.addObject({
                            category: box.obj_type,
                            id: box.obj_id,
                            count:1
                        });
                        window.editor.imageContextManager.boxes_manager.add_box(box1);
                        window.editor.floatLabelManager.add_label(box1);
                        window.editor.on_box_changed(box1);
                    })
                }
                else{
                    let res = JSON.parse(this.responseText)
                    res.forEach((anns,i)=>{
                        frame_index = start_frame+i;
                        if(!batch_selected_frames.includes(frame_index))
                            return;
                        let this_world = window.editor.data.worldList.find(w=>(w.frameInfo.scene==scene && w.frameInfo.frame_index==frame_index))
                        let frame_token = window.editor.data.meta[scene]["frames"][frame_index];
                        if(batch_selected_obj_id)
                            anns = anns.filter(b=>b.obj_id==batch_selected_obj_id)
                        anns.filter(b=>b.obj_id<0).forEach(b=>b.obj_id=objIdManager.generateNewUniqueId())
                        anns.forEach(b=>{
                            //匹配上的id赋给检测结果
                            _self.det[frame_token][b.det_index]["obj_id"] = b.obj_id;
                            let box = _self.det[frame_token][b.det_index];
                            if(_self.sizemap[scene][parseInt(box.obj_id)])
                                box.psr.scale = _self.sizemap[scene][parseInt(box.obj_id)];
                            //可视化跟踪结果
                            let box1 = this_world.annotation.add_box(box.psr.position,
                                box.psr.scale,
                                box.psr.rotation,
                                box.obj_type,
                                box.obj_id);
                            box1.velocity = box.velocity;
                            box1.annotator = 't';
                            objIdManager.addObject({
                                category: box.obj_type,
                                id: box.obj_id,
                                count:1
                            });
                            // window.editor.imageContextManager.boxes_manager.add_box(box1);
                            window.editor.floatLabelManager.add_label(box1);
                            window.editor.on_box_changed(box1);
                        })
                    });
                    window.editor.infoBox.show("Success","Track Success");
                }

                _self.change=false;
                if(finishCB)
                    finishCB();
            }
        }

        xhr.open('POST', `/iter_centertrack?change=${this.change}&batch_mode=${batch_mode}`, true);
        let para = []
        for (let track_frame = start_frame; track_frame <= frame_index; track_frame++) {
            let tracktoken = window.editor.data.meta[scene]["frames"][track_frame];
            para.push({"frame_index":track_frame,"dets":this.det[tracktoken]});
        }
        xhr.send(JSON.stringify(para));
    }

    this.reload = function(worldist,obj_id){
        let xhr = new XMLHttpRequest();
        let _self = this;
        xhr.onreadystatechange = function () {
            if (this.readyState !== 4)
                return;
            if (this.status == 200){
                let det1 = JSON.parse(this.responseText);
                worldist.forEach(w=>{
                    let frame_token = w.frameInfo.frame;
                    if(obj_id){
                        let this_det = _self.det[frame_token].find(d=>d.obj_id==obj_id);
                        this_det = det1[frame_token].find(d=>d.obj_id==obj_id);
                    }
                    else
                        _self.det[frame_token] = det1[frame_token];
                    let scene = w.frameInfo.scene;
                    let scene_index= scene.replace(/[^0-9]/ig,"");
                    let xhr1 = new XMLHttpRequest();
                    xhr1.onreadystatechange = function () {
                        if (this.readyState != 4)
                            return;
                        if (this.status == 200){
                            let res = JSON.parse(this.responseText)
                            if(res[frame_token])
                                _self.update_after_save(scene,frame_token,res[frame_token],obj_id);
                        }
                    }
                    xhr1.open('GET', `/get_has_ann?scene=${(scene_index+1).toString()}`, false);
                    xhr1.send();
                })
            }
        };
        xhr.open('GET', this.detection_file, true);
        xhr.send();
    }

    this.read_det_file(this.detection_file);
    for(let i=0;i<this.num_scene;i++)
        this.get_has_ann_frame(i);
}
export  {tracker};

