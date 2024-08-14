import hashlib
from sqlalchemy.orm import Session
from sqlalchemy.dialects.sqlite import insert as sqlite_upsert
from models.datasets_and_traces import db, User
 
def get_gravatar_hash(email):
    # see https://docs.gravatar.com/api/avatars/python/

    # Encode the email to lowercase and then to bytes
    email_encoded = email.lower().encode('utf-8')
     
    # Generate the SHA256 hash of the email
    email_hash = hashlib.sha256(email_encoded).hexdigest()
    
    return email_hash

def add_user_to_db(userinfo):
    # display information about the user in the database 
    with Session(db()) as session:
        user = {'id': userinfo['sub'],
                'username': userinfo['preferred_username'],
                'image_url_hash': get_gravatar_hash(userinfo['email'])}
        stmt = sqlite_upsert(User).values([user])
        stmt = stmt.on_conflict_do_update(index_elements=[User.id],
                                          set_={k:user[k] for k in user if k != 'id'})
        session.execute(stmt)