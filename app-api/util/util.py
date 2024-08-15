import hashlib
 
def get_gravatar_hash(email):
    # see https://docs.gravatar.com/api/avatars/python/

    # Encode the email to lowercase and then to bytes
    email_encoded = email.lower().encode('utf-8')
     
    # Generate the SHA256 hash of the email
    email_hash = hashlib.sha256(email_encoded).hexdigest()
    
    return email_hash