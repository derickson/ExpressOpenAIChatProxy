# uncomment to download latest version of provisioning vars
#gcloud secrets versions access latest --secret=llm_proxy_provision > provision.env
source provision.env

gcloud auth configure-docker $GCP_REGION-docker.pkg.dev

deploy_app() {
    echo $1
    docker build --platform linux/amd64 -t $GCP_REGION-docker.pkg.dev/$GCP_PROJECT_ID/notebook-workshop/llm-proxy-nginx$1 --file deploy/Dockerfile.nginx .
    docker push $GCP_REGION-docker.pkg.dev/$GCP_PROJECT_ID/notebook-workshop/llm-proxy-nginx$1

    docker build --platform linux/amd64 -t $GCP_REGION-docker.pkg.dev/$GCP_PROJECT_ID/notebook-workshop/llm-proxy$1 --file Dockerfile .
    docker push $GCP_REGION-docker.pkg.dev/$GCP_PROJECT_ID/notebook-workshop/llm-proxy$1

    cp deploy/llm-proxy.yaml.tmpl llm-proxy$1.yaml
    sed -i "" "s,"'$BUILD'",$1,g" llm-proxy$1.yaml
    sed -i "" "s,"'$GCP_PROJECT_ID'",$GCP_PROJECT_ID,g" llm-proxy$1.yaml
    sed -i "" "s,"'$GCP_REGION'",$GCP_REGION,g" llm-proxy$1.yaml
    sed -i "" "s,"'$GCP_LABELS_DIVISION'",$GCP_LABELS_DIVISION,g" llm-proxy$1.yaml
    sed -i "" "s,"'$GCP_LABELS_ORG'",$GCP_LABELS_ORG,g" llm-proxy$1.yaml
    sed -i "" "s,"'$GCP_LABELS_TEAM'",$GCP_LABELS_TEAM,g" llm-proxy$1.yaml
    sed -i "" "s,"'$BASE_URL'",$BASE_URL,g" llm-proxy$1.yaml
    gcloud run services replace llm-proxy$1.yaml
    rm -rf llm-proxy$1.yaml
}

# deploy_app '-test' for testing
deploy_app ''
