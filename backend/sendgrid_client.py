import os
from dotenv import load_dotenv
load_dotenv()
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail

message = Mail(
    from_email=os.environ.get('SENDGRID_FROM_EMAIL'),
    to_emails='to@example.com',
    subject='Sending with Twilio SendGrid is Fun',
    html_content='<strong>and easy to do anywhere, even with Python</strong>')
message.reply_to = os.environ.get('SENDGRID_REPLY_TO')
try:
    sg = SendGridAPIClient(os.environ.get('SENDGRID_API_KEY'))
    # sg.set_sendgrid_data_residency("eu")
    # uncomment the above line if you are sending mail using a regional EU subuser
    response = sg.send(message)
    print(response.status_code)
    print(response.body)
    print(response.headers)
except Exception as e:
    print(str(e))
