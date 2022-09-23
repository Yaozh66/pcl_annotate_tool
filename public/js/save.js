

function reloadWorldList(worldList, done,obj_id){
    var xhr = new XMLHttpRequest();
        // we defined the xhr
    xhr.onreadystatechange = function () {
        if (this.readyState != 4) return;
    
        if (this.status == 200) {
            let anns = JSON.parse(this.responseText);
            // load annotations
            anns.forEach(a=>{
                let world =worldList.find(w=>{
                        if(w.frameInfo.scene.substring(0,4)=="nusc")
                            return (w.frameInfo.scene == a.scene &&
                                w.frameInfo.frame_index == Number(a.frame));
                        else
                            return (w.frameInfo.scene == a.scene &&
                                w.frameInfo.frame == a.frame);
                    });
                if (world) {
                    if(world.data.cfg.mode=="test" && Number(a.frame)%world.data.cfg.testNFrame !==0 )
                        world.annotation.reapplyAnnotation([]);
                    else{
                        if(obj_id)
                            world.annotation.reapplyAnnotation(a.annotation.anns.filter(a=>a.obj_id==obj_id),null,true,obj_id);
                        else
                            world.annotation.reapplyAnnotation(a.annotation.anns);
                    }
                    window.editor.infoBox.show("Notice", "Reload Success")
                }
            });
            window.editor.tracker.reload(worldList,obj_id)
            if (done)
                done();
        }
    };
    
    xhr.open('POST', "/loadworldlist?mode="+window.editor.data.cfg.mode, true);

    let para = worldList.map(w=>{
        if(w.frameInfo.scene.substring(0,4)=="nusc")
            return{ scene: w.frameInfo.scene,
                frame: w.frameInfo.frame_index.toString()}
        else
            return {
                scene: w.frameInfo.scene,
                frame: w.frameInfo.frame,
            };
    });
    xhr.send(JSON.stringify(para));
}


var saveDelayTimer = null;
var pendingSaveList = [];

function saveWorldList(worldList,save_nusc = false){
    worldList.forEach(w=>{
        if (!pendingSaveList.includes(w))
            pendingSaveList.push(w);
    });

    if (saveDelayTimer)
        clearTimeout(saveDelayTimer);

    saveDelayTimer = setTimeout(()=>{

        //pandingSaveList will be cleared soon.
        let scene = pendingSaveList[0].frameInfo.scene;
        doSaveWorldList(pendingSaveList, ()=>{
            editor.header.updateModifiedStatus();
            // checkScene(scene);
        },save_nusc);

        //reset
        saveDelayTimer = null;
        pendingSaveList = [];
    },
    500);
}


function doSaveWorldList(worldList, done,save_nusc = false)
{
    if (worldList.length>0){
        if (worldList[0].data.cfg.disableLabels){
            window.editor.infoBox.show("Error!","labels not loaded, save action is prohibitted.")
            return;
        }
    }

    // console.log(worldList.length, "frames");
    let ann = worldList.map(w=>{
        if(w.frameInfo.scene.substring(0,4)=="nusc")
            return {
                scene: w.frameInfo.scene,
                frame: w.frameInfo.frame_index,
                annotation: w.annotation.toBoxAnnotations(),
            }
        else
            return {
                scene: w.frameInfo.scene,
                frame: w.frameInfo.frame,
                annotation: w.annotation.toBoxAnnotations(),
            };
    })

    var xhr = new XMLHttpRequest();
    xhr.open("POST", "/saveworldlist", true);
    xhr.setRequestHeader('Content-Type', 'application/json');

    xhr.onreadystatechange = function () {
        if (this.readyState != 4) return;
    
        if (this.status == 200) {
            worldList.forEach(w=>{
                w.annotation.resetModified();
                if(save_nusc)
                    window.editor.tracker.update_after_save(w.frameInfo.scene,w.frameInfo.frame,w.annotation.toBoxAnnotations())
            })
            if(save_nusc)
                window.editor.infoBox.show("Save","Save final result success in this frame")
            else
                window.editor.infoBox.show("Save","Save temporary result success in this frame")
            if(done)
                done();
        }
        else
            window.editor.infoBox.show("Error", `save failed, status : ${this.status}`);
        // end of state change: it can be after some time (async)
    };

    var b = JSON.stringify({"ann":ann,"save_nusc":save_nusc});
    //console.log(b);
    xhr.send(b);
}

export {saveWorldList, reloadWorldList}