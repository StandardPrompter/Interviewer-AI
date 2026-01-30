FROM public.ecr.aws/lambda/python:3.11

# Copy requirements.txt
COPY requirements.txt ${LAMBDA_TASK_ROOT}

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy function code
COPY app.py ${LAMBDA_TASK_ROOT}

# Set the CMD to your handler (could also be done in template.yaml)
CMD [ "app.lambda_handler" ]
