import json
from sqlalchemy.dialects.sqlite import insert as sqlite_upsert
from fastapi import HTTPException
from models.datasets_and_traces import Dataset, db, Trace, Annotation, User, SharedLinks
from util.util import get_gravatar_hash, split

def message_load(content):
    """
    Loads the messages of a trace and chunks all string leaves into {"token": "string", "address": "address"} objects,
    that can be used as annotation anchors.
    """
    try:
        messages = json.loads(content)
        messages = [translate_leaves_to_annotation_anchors(message, prefix=f"message[{i}]") for i, message in enumerate(messages)]
        return messages
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"role": "system", "content": "failed to load message data"}
    
def translate_leaves_to_annotation_anchors(object, prefix=""):
    if type(object) is dict:
        return {k: translate_leaves_to_annotation_anchors(v, prefix + "." + k) if k != 'role' else v for k, v in object.items()}
    if type(object) is list:
        return [translate_leaves_to_annotation_anchors(v, prefix + "[" + str(i) + "]") for i, v in enumerate(object)]
    if type(object) is str:
        if prefix.endswith(".content") or prefix.endswith(".function.name") or ".function.arguments" in prefix:
            # split by ' ' or '\n' and create a list of tokens
            return [{"token": token, "address": prefix + "." + str(i)} for i, token in enumerate(split(object, r"[\n]+"))]
    return object


def load_trace(session, trace_id, user_id, allow_shared=False, allow_public=False):
    trace = session.query(Trace).filter(Trace.id == trace_id).first()
    if trace is None:
        raise HTTPException(status_code=404, detail="Trace not found")
    
    dataset = session.query(Dataset).filter(Dataset.id == trace.dataset_id).first()
    
    if not (str(trace.user_id) == user_id or # correct user
            (allow_shared and user_id is None and has_link_sharing(session, trace_id)) or # in sharing mode
            allow_public and dataset.is_public # public dataset
            ):
        raise HTTPException(status_code=401, detail="Unauthorized get")
    
    # store in session that this is authenticated
    trace.authenticated = True
    
    return trace

def load_annoations(session, trace_id):
    return session.query(Annotation, User).filter(Annotation.trace_id == trace_id).join(User, User.id == Annotation.user_id).all()

def load_dataset(session, id, user_id, allow_public=False):
    dataset = session.query(Dataset).filter(Dataset.id == id).first()
    if dataset is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    if not (allow_public and dataset.is_public or str(dataset.user_id) == user_id):
        raise HTTPException(status_code=401, detail="Unauthorized get")
    return dataset

# returns the collections of a dataset
def get_collections(session, dataset: Dataset, num_traces: int):
    # get number of traces with at least one annotation
    num_annotated = session.query(Trace).filter(Trace.dataset_id == dataset.id)\
        .join(Annotation, Trace.id == Annotation.trace_id).count()
    
    return [
        {
            "id": "all",
            "name": "All",
            "count": num_traces
        },
        {
            "id": "annotated",
            "name": "Annotated",
            "count": num_annotated
        },
        {
            "id": "unannotated",
            "name": "Unannotated",
            "count": num_traces - num_annotated
        }
    ]

def has_link_sharing(session, trace_id):
    try:
        trace = session.query(SharedLinks).filter(SharedLinks.trace_id == trace_id).first()
        return trace is not None
    except Exception as e:
        return False

def save_user(session, userinfo):
    user = {'id': userinfo['sub'],
            'username': userinfo['preferred_username'],
            'image_url_hash': get_gravatar_hash(userinfo['email'])}
    stmt = sqlite_upsert(User).values([user])
    stmt = stmt.on_conflict_do_update(index_elements=[User.id],
                                      set_={k:user[k] for k in user if k != 'id'})
    session.execute(stmt)

def trace_to_json(trace, annotations=None):
    out = {
        "id": trace.id,
        "index": trace.index,
        "messages": message_load(trace.content),
        "dataset": trace.dataset_id,
        "extra_metadata": trace.extra_metadata
    }
    if annotations is not None:
        out['annotations'] = [annotation_to_json(annotation, user=user) for annotation, user in annotations]
    return out

def annotation_to_json(annotation, user=None):
    out = {
        "id": annotation.id,
        "content": annotation.content,
        "address": annotation.address
    }
    if user is not None:
        out['user'] = user_to_json(user)
    return out

def user_to_json(user):
    return {
        "id": user.id,
        "username": user.username,
        "image_url_hash": user.image_url_hash
    }
    
def dataset_to_json(dataset, user=None, **kwargs):
    out = {
            "id": dataset.id, 
            "name": dataset.name, 
            "path": dataset.path, 
            "extra_metadata": dataset.extra_metadata,
            "is_public": dataset.is_public,
        }
    out = {**out, **kwargs}
    if user:
        out["user"] = user_to_json(user)
    return out
 
    
